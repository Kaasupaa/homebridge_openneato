import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { OpenNeatoAccessory } from './accessory.js';
import type { DeviceConfig } from './types.js';

export class OpenNeatoPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Accessories cached by Homebridge between restarts
  private readonly cachedAccessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching – discovering devices');
      this.discoverDevices();
    });
  }

  // Called by Homebridge for every cached accessory on startup
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Restored cached accessory:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  private discoverDevices(): void {
    const devices: DeviceConfig[] = this.config['devices'] ?? [];

    if (devices.length === 0) {
      this.log.warn(
        'No devices configured. Add at least one entry under "devices" in Homebridge config.',
      );
      return;
    }

    const registeredUUIDs = new Set<string>();

    for (const device of devices) {
      if (!device.host) {
        this.log.error('Device is missing "host" – skipping:', JSON.stringify(device));
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`openneato-${device.host}`);
      registeredUUIDs.add(uuid);

      const existing = this.cachedAccessories.find(a => a.UUID === uuid);

      if (existing) {
        this.log.info(`Restoring [${device.name ?? device.host}] from cache`);
        existing.context.device = device;
        new OpenNeatoAccessory(this, existing, device);
      } else {
        const name = device.name ?? 'Neato';
        this.log.info(`Registering new accessory: ${name} (${device.host})`);
        const accessory = new this.api.platformAccessory(name, uuid);
        accessory.context.device = device;
        new OpenNeatoAccessory(this, accessory, device);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Unregister accessories that were removed from config
    for (const accessory of this.cachedAccessories) {
      if (!registeredUUIDs.has(accessory.UUID)) {
        this.log.info(`Removing stale accessory: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
