# Mobile LAN Shooter

A small high-effort multiplayer shooting game built for phones on the same Wi-Fi network.

## Features

- Mobile-first twin-stick controls
- Desktop fallback with `WASD` and mouse
- Real-time multiplayer over Socket.IO
- Health packs, respawns, leaderboard, and kill feed
- LAN-friendly server that binds to `0.0.0.0`

## Run

```bash
npm install
npm start
```

Then open the game in a browser on the same machine or on another device using the Wi-Fi IP shown by the server, for example:

```text
http://192.168.1.9:3000
```

## Notes

- Phones and the host computer need to be on the same local network.
- If Windows Firewall prompts you the first time, allow Node.js on private networks.
- The server also exposes `http://<host>:3000/config.json` with the LAN addresses it detects.
