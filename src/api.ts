import type {
  StateData,
  ChargerData,
  ErrorData,
  UserSettingsData,
  CleanAction,
  FanSpeed,
} from './types.js';

export class OpenNeatoApi {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(
    host: string,
    port = 80,
    timeout = 10_000,
    // Injected in tests to avoid real HTTP calls
    fetchFn: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.baseUrl = `http://${host}:${port}`;
    this.timeout = timeout;
    this._fetch = fetchFn;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) {
      throw new Error(`GET ${path} → HTTP ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private async post(path: string, params: Record<string, string> = {}): Promise<void> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await this._fetch(url.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) {
      throw new Error(`POST ${path} → HTTP ${res.status} ${res.statusText}`);
    }
  }

  getState(): Promise<StateData> {
    return this.get<StateData>('/api/state');
  }

  getCharger(): Promise<ChargerData> {
    return this.get<ChargerData>('/api/charger');
  }

  getError(): Promise<ErrorData> {
    return this.get<ErrorData>('/api/error');
  }

  getUserSettings(): Promise<UserSettingsData> {
    return this.get<UserSettingsData>('/api/user-settings');
  }

  clean(action: CleanAction): Promise<void> {
    return this.post('/api/clean', { action });
  }

  playSound(id: number): Promise<void> {
    return this.post('/api/sound', { id: String(id) });
  }

  setUserSetting(key: string, value: string): Promise<void> {
    return this.post('/api/user-settings', { key, value });
  }

  clearErrors(): Promise<void> {
    return this.post('/api/clear-errors');
  }

  async setFanSpeed(speed: FanSpeed): Promise<void> {
    if (speed === 'eco') {
      await this.setUserSetting('EcoMode', 'ON');
      await this.setUserSetting('IntenseClean', 'OFF');
    } else if (speed === 'intense') {
      await this.setUserSetting('EcoMode', 'OFF');
      await this.setUserSetting('IntenseClean', 'ON');
    } else {
      await this.setUserSetting('EcoMode', 'OFF');
      await this.setUserSetting('IntenseClean', 'OFF');
    }
  }
}
