# homebridge-openneato

Homebridge plugin for local control of Neato Botvac robot vacuums via the [OpenNeato](https://github.com/renjfk/OpenNeato) ESP32 firmware.

```
Neato D7
  → ESP32-C3 + OpenNeato
  → HTTP API (local network)
  → homebridge-openneato
  → HomeKit / Apple Home
```

**No cloud, no Neato account.** All communication happens on your local network.

---

## Features

| HomeKit element | Function |
|---|---|
| Fan (main tile) | On = start house clean, Off = return to dock |
| RotationSpeed | 1–33% = eco, 34–66% = normal, 67–100% = intense |
| Battery | Charge level %, charging state, low-battery alert |
| Pause switch | Pause / resume cleaning |
| Spot clean switch | Start / stop spot clean |
| Locate switch | Plays a locate sound on the robot (sound ID 19) |

### Siri examples

- *"Hey Siri, turn on Neato"* → starts house clean
- *"Hey Siri, turn off Neato"* → sends the robot back to the dock
- *"Hey Siri, what's Neato's battery level?"*

---

## Requirements

- Homebridge ≥ 1.6.0
- Node.js ≥ 18.0.0
- OpenNeato firmware installed on the ESP32
- ESP32 on the same local network as Homebridge

---

## Installation

### Via Homebridge (recommended)

Search for `homebridge-openneato` in **Homebridge Config UI** and install it.

### Manually on a Raspberry Pi

```bash
sudo npm install -g homebridge-openneato
```

### Development version (local)

```bash
# Clone the repo and install dependencies
git clone https://github.com/Kaasupaa/homebridge_openneato.git
cd homebridge_openneato
npm install

# Compile TypeScript
npm run build

# Link into your Homebridge installation
sudo npm link

# Link the plugin into Homebridge's global install
sudo npm link homebridge-openneato
```

---

## Configuration

Add to your `~/.homebridge/config.json`:

```json
{
  "platforms": [
    {
      "platform": "OpenNeato",
      "name": "OpenNeato",
      "devices": [
        {
          "name": "Neato",
          "host": "192.168.1.50",
          "port": 80,
          "pollInterval": 30,
          "timeout": 10
        }
      ]
    }
  ]
}
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | string | `"Neato"` | Name shown in Apple Home |
| `host` | string | **required** | IP address or hostname of the ESP32 |
| `port` | integer | `80` | HTTP port |
| `pollInterval` | integer | `30` | Status poll interval in seconds (5–300) |
| `timeout` | integer | `10` | Request timeout in seconds |

**Tip:** If the ESP32's IP can change, set a DHCP reservation (based on its MAC address) to keep it fixed.

---

## Development

### File structure

```
homebridge-openneato/
├── src/
│   ├── index.ts       # Plugin registration
│   ├── settings.ts    # Constants (PLUGIN_NAME, PLATFORM_NAME)
│   ├── platform.ts    # DynamicPlatformPlugin – device management
│   ├── accessory.ts   # OpenNeatoAccessory – HomeKit services and polling
│   ├── api.ts         # HTTP client for the OpenNeato ESP32
│   └── types.ts       # TypeScript types + state helper functions
├── test/
│   └── api.test.ts    # Unit tests (node:test)
├── dist/              # Compiled JavaScript (gitignored)
├── config.schema.json # Homebridge Config UI schema
├── package.json
└── tsconfig.json
```

### Commands

```bash
# Compile TypeScript → dist/
npm run build

# Watch for changes and rebuild automatically
npm run watch

# Run tests (no separate build step required)
npm test

# Start Homebridge in debug mode
homebridge -D
```

### Debug logs

Start Homebridge with the `-D` flag to see plugin logs:

```bash
homebridge -D
```

The plugin writes debug messages in the form `[Neato] ...`. Info-level messages (commands, errors, state changes) are always shown during normal operation.

### Tests

Tests use Node.js's built-in `node:test` module and `tsx` for TypeScript support. Fetch calls are mocked by injecting a mock function into the `OpenNeatoApi` constructor — no `global.fetch` monkey-patching.

```bash
npm test
```

---

## HomeKit architecture

HomeKit has no native Robot Vacuum service (there's no VacuumCleaner service in the HAP spec). The plugin uses:

- **Fanv2** (`Service.Fanv2`) as the main service, because it supports both the `Active` characteristic (on/off) and `RotationSpeed` (fan speed = cleaning power). Siri understands this naturally.
- **Battery** with exact charge level and charging state.
- Separate **Switch** services for pause, spot clean, and locate.

---

## Publishing to npm

```bash
# 1. Make sure everything works
npm run build && npm test

# 2. Log in to npm
npm login

# 3. Publish
npm publish
```

---

## License

MIT
