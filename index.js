const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, delay } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

function makeSessionId(filePath) {
  const creds = fs.readFileSync(filePath, 'utf8');
  const b64 = Buffer.from(creds).toString('base64');
  return `METRO~${b64}`;
}

app.get('/code', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.json({ error: "Provide number ?number=2547xxxx" });
  num = num.replace(/[^0-9]/g, '');

  const sessionDir = `./temp/${num}`;
  if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    browser: ["METRO MD", "Chrome", "1.0"],
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!state.creds.registered) {
    await delay(3000);
    try {
      let code = await sock.requestPairingCode(num);
      res.json({ code: code });

      // Wait for user to enter code and connect
      sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
          await delay(5000);
          const credsPath = `${sessionDir}/creds.json`;
          if (fs.existsSync(credsPath)) {
            const sessionId = makeSessionId(credsPath);
            console.log(`NEW SESSION for ${num}: ${sessionId}`);
            await sock.sendMessage(sock.user.id, { text: sessionId });
            await sock.sendMessage(sock.user.id, { text: `*METRO MD SESSION CONNECTED*\n\nYour Session ID:\n${sessionId}\n\nCopy this and put in your bot's SESSION_ID env variable or session folder.` });
            await delay(2000);
            fs.rmSync(sessionDir, { recursive: true });
            process.exit(0);
          }
        }
      });

    } catch (e) {
      res.json({ error: e.message });
      if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true });
    }
  } else {
    res.json({ error: "Number already registered, delete session" });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`METRO PAIR running on port ${PORT}`));
