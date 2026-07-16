import type { PlatformAccessory, CharacteristicValue, Service } from 'homebridge';
import type { OpenNeatoPlatform } from './platform.js';
import { OpenNeatoApi } from './api.js';
import {
  type StateData,
  type ChargerData,
  type ErrorData,
  type UserSettingsData,
  type DeviceConfig,
  VacuumActivity,
  deriveActivity,
  deriveFanSpeed,
  fanSpeedToRotation,
  rotationToFanSpeed,
} from './types.js';

const LOCATE_SOUND_ID = 19;
const LOW_BATTERY_THRESHOLD = 20;
const LOCATE_AUTO_OFF_MS = 3_000;
const POST_COMMAND_REFRESH_MS = 2_000;
// Give up marking device as unreachable after this many consecutive poll failures
const OFFLINE_AFTER_FAILURES = 3;

export class OpenNeatoAccessory {
  private readonly robot: OpenNeatoApi;
  private readonly label: string;

  // HomeKit services
  private readonly fanService: Service;
  private readonly batteryService: Service;
  private readonly pauseSwitch: Service;
  private readonly spotSwitch: Service;
  private readonly locateSwitch: Service;

  // Cached poll data – stale on startup until first successful poll
  private cachedState: StateData | null = null;
  private cachedCharger: ChargerData | null = null;
  private cachedError: ErrorData | null = null;
  private cachedSettings: UserSettingsData | null = null;

  private consecutiveFailures = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly platform: OpenNeatoPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: DeviceConfig,
  ) {
    const { Service, Characteristic } = platform;
    this.label = config.name ?? config.host;

    this.robot = new OpenNeatoApi(
      config.host,
      config.port ?? 80,
      (config.timeout ?? 10) * 1_000,
    );

    // ── Accessory information ────────────────────────────────────────────────
    accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Neato Robotics / OpenNeato')
      .setCharacteristic(Characteristic.Model, 'Neato Botvac')
      .setCharacteristic(Characteristic.SerialNumber, config.host);

    // ── Fan v2 – primary service (cleaning on/off + fan speed) ──────────────
    // Fan v2 chosen because it supports both Active (on/off) and RotationSpeed
    // (eco / normal / intense), and is natively understood by Siri and Shortcuts.
    this.fanService =
      accessory.getService(Service.Fanv2) ??
      accessory.addService(Service.Fanv2, this.label, 'main');

    this.fanService.setCharacteristic(Characteristic.Name, this.label);

    this.fanService
      .getCharacteristic(Characteristic.Active)
      .onGet(this.getFanActive.bind(this))
      .onSet(this.setFanActive.bind(this));

    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 1, maxValue: 100, minStep: 1 })
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));

    // ── Battery ──────────────────────────────────────────────────────────────
    this.batteryService =
      accessory.getService(Service.Battery) ?? accessory.addService(Service.Battery);

    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this));

    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(this.getLowBattery.bind(this));

    // ── Pause/resume switch ──────────────────────────────────────────────────
    this.pauseSwitch =
      accessory.getServiceById(Service.Switch, 'pause') ??
      accessory.addService(Service.Switch, 'Tauko', 'pause');

    this.pauseSwitch.setCharacteristic(Characteristic.Name, 'Tauko');
    this.pauseSwitch
      .getCharacteristic(Characteristic.On)
      .onGet(this.getPaused.bind(this))
      .onSet(this.setPaused.bind(this));

    // ── Spot cleaning switch ─────────────────────────────────────────────────
    this.spotSwitch =
      accessory.getServiceById(Service.Switch, 'spot') ??
      accessory.addService(Service.Switch, 'Spot-siivous', 'spot');

    this.spotSwitch.setCharacteristic(Characteristic.Name, 'Spot-siivous');
    this.spotSwitch
      .getCharacteristic(Characteristic.On)
      .onGet(this.getSpot.bind(this))
      .onSet(this.setSpot.bind(this));

    // ── Locate switch (auto-off after 3 s) ───────────────────────────────────
    this.locateSwitch =
      accessory.getServiceById(Service.Switch, 'locate') ??
      accessory.addService(Service.Switch, 'Etsi Neato', 'locate');

    this.locateSwitch.setCharacteristic(Characteristic.Name, 'Etsi Neato');
    this.locateSwitch
      .getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(this.setLocate.bind(this));

    // ── Start polling ────────────────────────────────────────────────────────
    const pollMs = (config.pollInterval ?? 30) * 1_000;
    this.poll().catch(() => undefined);
    this.pollTimer = setInterval(() => this.poll().catch(() => undefined), pollMs);
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  private activity(): VacuumActivity {
    return deriveActivity(this.cachedState, this.cachedCharger, this.cachedError);
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    let stateOk = false;

    try {
      // Critical endpoints – must both succeed or we count a failure
      const [state, charger] = await Promise.all([
        this.robot.getState(),
        this.robot.getCharger(),
      ]);
      this.cachedState = state;
      this.cachedCharger = charger;
      stateOk = true;
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= OFFLINE_AFTER_FAILURES) {
        this.platform.log.warn(
          `[${this.label}] Device unreachable (${this.consecutiveFailures} failures): ${err}`,
        );
      } else {
        this.platform.log.debug(`[${this.label}] Poll failed: ${err}`);
      }
    }

    if (!stateOk) return;

    // Non-critical – failures don't block characteristic updates
    await Promise.allSettled([
      this.robot.getError().then(d => { this.cachedError = d; }),
      this.robot.getUserSettings().then(d => { this.cachedSettings = d; }),
    ]);

    this.pushCharacteristics();
  }

  private pushCharacteristics(): void {
    const { Characteristic } = this.platform;
    const act = this.activity();
    const isActive = act === VacuumActivity.CLEANING || act === VacuumActivity.SPOT;
    const isPaused = act === VacuumActivity.PAUSED;
    const isSpot = act === VacuumActivity.SPOT;
    const charger = this.cachedCharger;

    // Fan v2
    this.fanService.updateCharacteristic(
      Characteristic.Active,
      isActive
        ? Characteristic.Active.ACTIVE
        : Characteristic.Active.INACTIVE,
    );
    this.fanService.updateCharacteristic(
      Characteristic.RotationSpeed,
      fanSpeedToRotation(deriveFanSpeed(this.cachedSettings)),
    );

    // Battery
    if (charger) {
      this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, charger.fuelPercent);
      this.batteryService.updateCharacteristic(
        Characteristic.ChargingState,
        charger.chargingActive
          ? Characteristic.ChargingState.CHARGING
          : Characteristic.ChargingState.NOT_CHARGING,
      );
      this.batteryService.updateCharacteristic(
        Characteristic.StatusLowBattery,
        charger.fuelPercent < LOW_BATTERY_THRESHOLD
          ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
    }

    // Extra switches
    this.pauseSwitch.updateCharacteristic(Characteristic.On, isPaused);
    this.spotSwitch.updateCharacteristic(Characteristic.On, isSpot);
  }

  // ── Command helper ────────────────────────────────────────────────────────

  private async sendCommand(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      // Refresh shortly after command so HomeKit reflects new state
      setTimeout(() => this.poll().catch(() => undefined), POST_COMMAND_REFRESH_MS);
    } catch (err) {
      this.platform.log.error(`[${this.label}] Command failed: ${err}`);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  // ── Fan v2 getters/setters ────────────────────────────────────────────────

  async getFanActive(): Promise<CharacteristicValue> {
    const act = this.activity();
    return act === VacuumActivity.CLEANING || act === VacuumActivity.SPOT
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  async setFanActive(value: CharacteristicValue): Promise<void> {
    const { Active } = this.platform.Characteristic;
    const wantActive = value === Active.ACTIVE;
    const act = this.activity();

    if (wantActive) {
      if (act === VacuumActivity.PAUSED) {
        this.platform.log.info(`[${this.label}] Resuming cleaning`);
        await this.sendCommand(() => this.robot.clean('house'));
      } else if (act !== VacuumActivity.CLEANING && act !== VacuumActivity.SPOT) {
        this.platform.log.info(`[${this.label}] Starting house clean`);
        await this.sendCommand(() => this.robot.clean('house'));
      }
      // Already cleaning → no-op
    } else {
      if (
        act === VacuumActivity.CLEANING ||
        act === VacuumActivity.SPOT ||
        act === VacuumActivity.PAUSED ||
        act === VacuumActivity.RETURNING
      ) {
        this.platform.log.info(`[${this.label}] Returning to dock`);
        await this.sendCommand(() => this.robot.clean('dock'));
      }
      // Already docked/idle → no-op
    }
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    return fanSpeedToRotation(deriveFanSpeed(this.cachedSettings));
  }

  async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    const speed = rotationToFanSpeed(value as number);
    this.platform.log.info(`[${this.label}] Fan speed → ${speed}`);
    await this.sendCommand(() => this.robot.setFanSpeed(speed));
  }

  // ── Battery getters ───────────────────────────────────────────────────────

  async getBatteryLevel(): Promise<CharacteristicValue> {
    return this.cachedCharger?.fuelPercent ?? 0;
  }

  async getChargingState(): Promise<CharacteristicValue> {
    return this.cachedCharger?.chargingActive
      ? this.platform.Characteristic.ChargingState.CHARGING
      : this.platform.Characteristic.ChargingState.NOT_CHARGING;
  }

  async getLowBattery(): Promise<CharacteristicValue> {
    const pct = this.cachedCharger?.fuelPercent ?? 100;
    return pct < LOW_BATTERY_THRESHOLD
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  // ── Pause switch ──────────────────────────────────────────────────────────

  async getPaused(): Promise<CharacteristicValue> {
    return this.activity() === VacuumActivity.PAUSED;
  }

  async setPaused(value: CharacteristicValue): Promise<void> {
    const act = this.activity();
    if (value) {
      if (act === VacuumActivity.CLEANING || act === VacuumActivity.SPOT) {
        this.platform.log.info(`[${this.label}] Pausing`);
        await this.sendCommand(() => this.robot.clean('pause'));
      }
    } else {
      if (act === VacuumActivity.PAUSED) {
        this.platform.log.info(`[${this.label}] Resuming`);
        await this.sendCommand(() => this.robot.clean('house'));
      }
    }
  }

  // ── Spot switch ───────────────────────────────────────────────────────────

  async getSpot(): Promise<CharacteristicValue> {
    return this.activity() === VacuumActivity.SPOT;
  }

  async setSpot(value: CharacteristicValue): Promise<void> {
    if (value) {
      this.platform.log.info(`[${this.label}] Starting spot clean`);
      await this.sendCommand(() => this.robot.clean('spot'));
    } else {
      const act = this.activity();
      if (act === VacuumActivity.SPOT || act === VacuumActivity.PAUSED) {
        this.platform.log.info(`[${this.label}] Stopping spot clean → dock`);
        await this.sendCommand(() => this.robot.clean('dock'));
      }
    }
  }

  // ── Locate switch ─────────────────────────────────────────────────────────

  async setLocate(value: CharacteristicValue): Promise<void> {
    if (!value) return;
    this.platform.log.info(`[${this.label}] Locate – playing sound`);
    await this.sendCommand(() => this.robot.playSound(LOCATE_SOUND_ID));
    // Auto-off: HomeKit shows the switch briefly pressed
    setTimeout(() => {
      this.locateSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
    }, LOCATE_AUTO_OFF_MS);
  }
}
