// API response shapes – field names verified against OpenNeato firmware (neato_commands.cpp)

export interface StateData {
  uiState: string;
  robotState: string;
}

export interface ChargerData {
  fuelPercent: number;
  batteryOverTemp: boolean;
  chargingActive: boolean;
  chargingEnabled: boolean;
  confidOnFuel: boolean;
  onReservedFuel: boolean;
  emptyFuel: boolean;
  batteryFailure: boolean;
  extPwrPresent: boolean;
  vBattV: number;
  vExtV: number;
  chargerMAH: number;
  dischargeMAH: number;
}

export interface ErrorData {
  hasError: boolean;
  kind: 'error' | 'warning' | '';
  errorCode: number;
  errorMessage: string;
  displayMessage: string;
}

export interface UserSettingsData {
  EcoMode: boolean;
  IntenseClean: boolean;
  [key: string]: unknown;
}

export interface DeviceConfig {
  name?: string;
  host: string;
  port?: number;
  pollInterval?: number;
  timeout?: number;
}

export type CleanAction = 'house' | 'spot' | 'pause' | 'stop' | 'dock';
export type FanSpeed = 'eco' | 'normal' | 'intense';

// Derived activity state – not a field returned by the API, computed locally
export enum VacuumActivity {
  CLEANING = 'cleaning',
  SPOT = 'spot',
  PAUSED = 'paused',
  RETURNING = 'returning',
  DOCKED = 'docked',
  IDLE = 'idle',
  ERROR = 'error',
}

// uiState substring → VacuumActivity, priority order matters
export function deriveActivity(
  state: StateData | null,
  charger: ChargerData | null,
  error: ErrorData | null,
): VacuumActivity {
  if (error?.hasError) return VacuumActivity.ERROR;
  if (!state) return charger?.extPwrPresent ? VacuumActivity.DOCKED : VacuumActivity.IDLE;

  const ui = state.uiState;
  if (ui.includes('CLEANINGRUNNING') || ui.includes('MANUALCLEANING')) return VacuumActivity.CLEANING;
  if (ui.includes('SPOT')) return VacuumActivity.SPOT;
  if (ui.includes('CLEANINGPAUSED') || ui.includes('CLEANINGSUSPENDED')) return VacuumActivity.PAUSED;
  if (ui.includes('DOCKING')) return VacuumActivity.RETURNING;
  if (charger?.extPwrPresent) return VacuumActivity.DOCKED;
  return VacuumActivity.IDLE;
}

export function deriveFanSpeed(settings: UserSettingsData | null): FanSpeed {
  if (!settings) return 'normal';
  if (settings.EcoMode) return 'eco';
  if (settings.IntenseClean) return 'intense';
  return 'normal';
}

// HomeKit RotationSpeed (1–100) ↔ FanSpeed
export function fanSpeedToRotation(speed: FanSpeed): number {
  if (speed === 'eco') return 33;
  if (speed === 'intense') return 100;
  return 66;
}

export function rotationToFanSpeed(rotation: number): FanSpeed {
  if (rotation <= 33) return 'eco';
  if (rotation <= 66) return 'normal';
  return 'intense';
}
