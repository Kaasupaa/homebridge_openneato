import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OpenNeatoApi } from '../src/api.js';
import {
  deriveActivity,
  deriveFanSpeed,
  fanSpeedToRotation,
  rotationToFanSpeed,
  VacuumActivity,
} from '../src/types.js';
import type { StateData, ChargerData, ErrorData, UserSettingsData } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}

function makeState(uiState: string): StateData {
  return { uiState, robotState: 'ST_Test' };
}

function makeCharger(overrides: Partial<ChargerData> = {}): ChargerData {
  return {
    fuelPercent: 80,
    batteryOverTemp: false,
    chargingActive: false,
    chargingEnabled: false,
    confidOnFuel: true,
    onReservedFuel: false,
    emptyFuel: false,
    batteryFailure: false,
    extPwrPresent: false,
    vBattV: 14.2,
    vExtV: 0,
    chargerMAH: 0,
    dischargeMAH: 0,
    ...overrides,
  };
}

// ── deriveActivity ────────────────────────────────────────────────────────────

describe('deriveActivity', () => {
  it('returns CLEANING for CLEANINGRUNNING', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_CLEANINGRUNNING'), makeCharger(), null),
      VacuumActivity.CLEANING,
    );
  });

  it('returns CLEANING for MANUALCLEANING', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_MANUALCLEANING'), makeCharger(), null),
      VacuumActivity.CLEANING,
    );
  });

  it('returns SPOT for SPOT', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_SPOT'), makeCharger(), null),
      VacuumActivity.SPOT,
    );
  });

  it('returns PAUSED for CLEANINGPAUSED', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_CLEANINGPAUSED'), makeCharger(), null),
      VacuumActivity.PAUSED,
    );
  });

  it('returns PAUSED for CLEANINGSUSPENDED', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_CLEANINGSUSPENDED'), makeCharger(), null),
      VacuumActivity.PAUSED,
    );
  });

  it('returns RETURNING for DOCKING', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_DOCKING'), makeCharger(), null),
      VacuumActivity.RETURNING,
    );
  });

  it('returns DOCKED when extPwrPresent and idle state', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_IDLE'), makeCharger({ extPwrPresent: true }), null),
      VacuumActivity.DOCKED,
    );
  });

  it('returns IDLE when standby and not on dock', () => {
    assert.equal(
      deriveActivity(makeState('UIMGR_STATE_STANDBY'), makeCharger(), null),
      VacuumActivity.IDLE,
    );
  });

  it('returns ERROR when error reported', () => {
    const error: ErrorData = {
      hasError: true,
      kind: 'error',
      errorCode: 500,
      errorMessage: 'test error',
      displayMessage: 'Something went wrong',
    };
    assert.equal(deriveActivity(makeState('UIMGR_STATE_IDLE'), makeCharger(), error), VacuumActivity.ERROR);
  });

  it('returns DOCKED when state is null but extPwrPresent', () => {
    assert.equal(deriveActivity(null, makeCharger({ extPwrPresent: true }), null), VacuumActivity.DOCKED);
  });

  it('returns IDLE when state and charger are null', () => {
    assert.equal(deriveActivity(null, null, null), VacuumActivity.IDLE);
  });
});

// ── deriveFanSpeed ────────────────────────────────────────────────────────────

describe('deriveFanSpeed', () => {
  const base: UserSettingsData = { EcoMode: false, IntenseClean: false };

  it('eco when EcoMode true', () => {
    assert.equal(deriveFanSpeed({ ...base, EcoMode: true }), 'eco');
  });

  it('intense when IntenseClean true', () => {
    assert.equal(deriveFanSpeed({ ...base, IntenseClean: true }), 'intense');
  });

  it('normal when both false', () => {
    assert.equal(deriveFanSpeed(base), 'normal');
  });

  it('normal when settings null', () => {
    assert.equal(deriveFanSpeed(null), 'normal');
  });
});

// ── fanSpeedToRotation / rotationToFanSpeed ───────────────────────────────────

describe('fanSpeedToRotation', () => {
  it('eco → 33', () => assert.equal(fanSpeedToRotation('eco'), 33));
  it('normal → 66', () => assert.equal(fanSpeedToRotation('normal'), 66));
  it('intense → 100', () => assert.equal(fanSpeedToRotation('intense'), 100));
});

describe('rotationToFanSpeed', () => {
  it('1 → eco', () => assert.equal(rotationToFanSpeed(1), 'eco'));
  it('33 → eco', () => assert.equal(rotationToFanSpeed(33), 'eco'));
  it('34 → normal', () => assert.equal(rotationToFanSpeed(34), 'normal'));
  it('66 → normal', () => assert.equal(rotationToFanSpeed(66), 'normal'));
  it('67 → intense', () => assert.equal(rotationToFanSpeed(67), 'intense'));
  it('100 → intense', () => assert.equal(rotationToFanSpeed(100), 'intense'));
});

// ── OpenNeatoApi ──────────────────────────────────────────────────────────────

describe('OpenNeatoApi', () => {
  it('getState returns parsed JSON', async () => {
    const expected: StateData = { uiState: 'CLEANINGRUNNING', robotState: 'ST_C_Cleaning' };
    const api = new OpenNeatoApi('192.168.1.50', 80, 5000, makeFetch(expected));
    const result = await api.getState();
    assert.deepEqual(result, expected);
  });

  it('getCharger returns parsed JSON', async () => {
    const expected = makeCharger({ fuelPercent: 55 });
    const api = new OpenNeatoApi('192.168.1.50', 80, 5000, makeFetch(expected));
    const result = await api.getCharger();
    assert.equal(result.fuelPercent, 55);
  });

  it('throws on HTTP 500', async () => {
    const api = new OpenNeatoApi('192.168.1.50', 80, 5000, makeFetch({ error: 'fail' }, 500));
    await assert.rejects(() => api.getState(), /HTTP 500/);
  });

  it('clean sends correct action param', async () => {
    let capturedUrl = '';
    const mockFetch: typeof globalThis.fetch = async (input) => {
      capturedUrl = input.toString();
      return new Response('{}', { status: 200 });
    };
    const api = new OpenNeatoApi('192.168.1.50', 80, 5000, mockFetch);
    await api.clean('house');
    assert.ok(capturedUrl.includes('/api/clean'), 'URL should contain /api/clean');
    assert.ok(capturedUrl.includes('action=house'), 'URL should contain action=house');
  });

  it('playSound sends correct id param', async () => {
    let capturedUrl = '';
    const mockFetch: typeof globalThis.fetch = async (input) => {
      capturedUrl = input.toString();
      return new Response('{}', { status: 200 });
    };
    const api = new OpenNeatoApi('192.168.1.50', 80, 5000, mockFetch);
    await api.playSound(19);
    assert.ok(capturedUrl.includes('id=19'), 'URL should contain id=19');
  });

  it('setFanSpeed eco sets correct user settings', async () => {
    const calls: string[] = [];
    const mockFetch: typeof globalThis.fetch = async (input) => {
      calls.push(input.toString());
      return new Response('{}', { status: 200 });
    };
    const api = new OpenNeatoApi('192.168.1.50', 80, 5000, mockFetch);
    await api.setFanSpeed('eco');
    assert.ok(calls.some(u => u.includes('EcoMode') && u.includes('ON')));
    assert.ok(calls.some(u => u.includes('IntenseClean') && u.includes('OFF')));
  });

  it('setFanSpeed intense sets correct user settings', async () => {
    const calls: string[] = [];
    const mockFetch: typeof globalThis.fetch = async (input) => {
      calls.push(input.toString());
      return new Response('{}', { status: 200 });
    };
    const api = new OpenNeatoApi('192.168.1.50', 80, 5000, mockFetch);
    await api.setFanSpeed('intense');
    assert.ok(calls.some(u => u.includes('EcoMode') && u.includes('OFF')));
    assert.ok(calls.some(u => u.includes('IntenseClean') && u.includes('ON')));
  });
});
