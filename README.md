# homebridge-openneato

Homebridge-plugin Neato Botvac -robotti-imurille paikallisen [OpenNeato](https://github.com/renjfk/OpenNeato) ESP32 -firmwaren kautta.

```
Neato D7
  → ESP32-C3 + OpenNeato
  → HTTP API (lähiverkko)
  → homebridge-openneato
  → HomeKit / Apple Koti
```

**Ei pilveä, ei Neato-tiliä.** Kaikki kommunikointi tapahtuu paikallisessa verkossa.

---

## Ominaisuudet

| HomeKit-elementti | Toiminto |
|---|---|
| Fan (päätile) | Päälle = aloita house clean, Pois = palaa telakkaan |
| RotationSpeed | 1–33 % = eco, 34–66 % = normal, 67–100 % = intense |
| Akku | Varaustaso %, latauksen tila, matalan akun hälytys |
| Tauko-kytkin | Keskeytä / jatka siivous |
| Spot-siivous-kytkin | Aloita / lopeta spot clean |
| Etsi Neato -kytkin | Soittaa robotissa äänihälytyksen (sound ID 19) |

### Siri-esimerkit

- *"Hey Siri, laita Neato päälle"* → aloittaa house clean
- *"Hey Siri, sammuta Neato"* → lähettää robotin telakkaan
- *"Hey Siri, mikä on Neaton akun tila?"*

---

## Vaatimukset

- Homebridge ≥ 1.6.0
- Node.js ≥ 18.0.0
- OpenNeato-firmware asennettuna ESP32:lle
- ESP32 samassa lähiverkossa kuin Homebridge

---

## Asennus

### Homebridgellä (suositeltu)

Hae **Homebridge Config UI** -käyttöliittymästä `homebridge-openneato` ja asenna.

### Manuaalisesti Raspberry Pillä

```bash
sudo npm install -g homebridge-openneato
```

### Kehitysversio (lokaalisti)

```bash
# Kloonaa repo ja asenna riippuvuudet
git clone https://github.com/sinun-tunnus/homebridge-openneato.git
cd homebridge-openneato
npm install

# Käännä TypeScript
npm run build

# Linkitä Homebridge-asennukseen
sudo npm link

# Linkitä Homebridgen globaaliin asennukseen
sudo npm link homebridge-openneato
```

---

## Konfiguraatio

Lisää `~/.homebridge/config.json` -tiedostoon:

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

### Konfiguraatio-asetukset

| Asetus | Tyyppi | Oletus | Kuvaus |
|---|---|---|---|
| `name` | string | `"Neato"` | Nimi Apple Kotissa |
| `host` | string | **pakollinen** | ESP32:n IP-osoite tai hostname |
| `port` | integer | `80` | HTTP-portti |
| `pollInterval` | integer | `30` | Tilakyselyväli sekunteina (5–300) |
| `timeout` | integer | `10` | Pyyntöjen timeout sekunteina |

**Vinkki:** Jos ESP32:n IP voi vaihtua, aseta se kiinteäksi DHCP-palvelimesta (MAC-osoite-pohjainen varaus).

---

## Kehitys

### Tiedostorakenne

```
homebridge-openneato/
├── src/
│   ├── index.ts       # Plugin-rekisteröinti
│   ├── settings.ts    # Vakiot (PLUGIN_NAME, PLATFORM_NAME)
│   ├── platform.ts    # DynamicPlatformPlugin – laitteiden hallinta
│   ├── accessory.ts   # OpenNeatoAccessory – HomeKit-palvelut ja polling
│   ├── api.ts         # HTTP-asiakas OpenNeato ESP32:lle
│   └── types.ts       # TypeScript-tyypit + tila-apufunktiot
├── test/
│   └── api.test.ts    # Yksikkötestit (node:test)
├── dist/              # Käännetty JavaScript (gitignore)
├── config.schema.json # Homebridge Config UI -kaavio
├── package.json
└── tsconfig.json
```

### Komennnot

```bash
# Käännä TypeScript → dist/
npm run build

# Tarkkaile muutoksia ja käännä automaattisesti
npm run watch

# Aja testit (ei vaadi erillistä build-vaihetta)
npm test

# Käynnistä Homebridge debug-tilassa
homebridge -D
```

### Debug-lokit

Käynnistä Homebridge `-D`-lipulla nähdäksesi plugin-lokit:

```bash
homebridge -D
```

Plugin kirjoittaa debug-viestit muodossa `[Neato] ...`. Info-tason viestit näkyvät aina normaalissa ajossa (komennot, virheet, tila-muutokset).

### Testit

Testit käyttävät Node.js:n sisäänrakennettua `node:test`-moduulia ja `tsx`:ää TypeScript-tuen lisäämiseksi. Fetch-kutsut mockataan injektoimalla mock-funktio `OpenNeatoApi`-konstruktoriin — ei `global.fetch`-monkey-patching.

```bash
npm test
```

---

## HomeKit-arkkitehtuuri

HomeKit ei tue natiivia Robot Vacuum -palvelua (HAP-spekissä ei ole VacuumCleaner-serviceä). Plugin käyttää:

- **Fanv2** (`Service.Fanv2`) pääpalveluna, koska se tukee sekä `Active`-karakteristiikkaa (on/off) että `RotationSpeed`-karakteristiikkaa (fan speed = siivousteho). Siri ymmärtää tämän luontevasti.
- **Battery** tarkalla varaustasolla ja latauksen tilalla.
- Erilliset **Switch**-palvelut pause-, spot- ja locate-toiminnoille.

---

## Julkaisu npm:ään

```bash
# 1. Varmista että kaikki toimii
npm run build && npm test

# 2. Kirjaudu npm:ään
npm login

# 3. Julkaise
npm publish
```

Jotta plugin näkyy Homebridge Config UI:ssa, lisää `package.json`-tiedostoon:
```json
"keywords": ["homebridge-plugin"]
```

---

## Lisenssi

MIT
