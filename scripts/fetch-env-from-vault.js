const axios = require('axios');
const fs = require('fs');
const path = require('path');

// CONFIG - must be provided by environment (no insecure defaults)
const VAULT_ADDR = process.env.VAULT_ADDR;
const VAULT_TOKEN = process.env.VAULT_TOKEN;
const VAULT_SECRET_PATH = process.env.VAULT_SECRET_PATH;

const fallbackEnvPath = path.resolve(__dirname, '../.env.local');
const envPath = path.resolve(__dirname, '../.env');
const dockerEnvPath = path.resolve(__dirname, '../DockerEnv');

function isValidVaultAddr(addr) {
  try {
    if (typeof addr !== 'string') return false;
    if (addr.includes('\n') || addr.includes('\r')) return false;
    const u = new URL(addr);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchVaultSecrets() {
  try {
    if (!VAULT_ADDR) throw new Error('VAULT_ADDR is not set');
    if (!isValidVaultAddr(VAULT_ADDR)) throw new Error('VAULT_ADDR is invalid');
    if (!VAULT_TOKEN) throw new Error('VAULT_TOKEN is not set');
    if (!VAULT_SECRET_PATH) throw new Error('VAULT_SECRET_PATH is not set');

    const response = await axios.get(`${VAULT_ADDR}/v1/${VAULT_SECRET_PATH}`, {
      headers: {
        'X-Vault-Token': VAULT_TOKEN,
      },
      timeout: 3000,
    });

    const secrets = response.data.data.data;

    // Validate VERSION
    const version = secrets.VERSION?.trim();
    if (!version || version.includes('http') || version.includes('/')) {
      throw new Error(`VERSION ที่ได้จาก Vault ไม่ถูกต้อง: '${version}'`);
    }

    const envContent = [];
    const dockerEnvContent = [];

    for (const [key, value] of Object.entries(secrets)) {
      const k = key.trim().replace(/[^A-Z0-9_]/gi, '_');
      const v = String(value).trim().replace(/\s+/g, ' ');
      envContent.push(`${k}=${v}`);
      dockerEnvContent.push(`ENV ${k}=${v}`);
    }

    fs.writeFileSync(envPath, envContent.join('\n'));
    fs.writeFileSync(dockerEnvPath, dockerEnvContent.join('\n'));

    console.log(`✅ สร้าง .env และ DockerEnv สำเร็จจาก Vault path: ${VAULT_SECRET_PATH}`);
  } catch (err) {
    console.warn(`⚠️ ดึง secret จาก Vault ไม่สำเร็จ: ${err.message}`);

    // fallback
    if (fs.existsSync(fallbackEnvPath)) {
      fs.copyFileSync(fallbackEnvPath, envPath);
      console.log('✅ โหลด .env จาก fallback .env.local แทน');

      // generate DockerEnv จาก fallback ด้วย
      const fallbackContent = fs.readFileSync(fallbackEnvPath, 'utf-8');
      const lines = fallbackContent.split('\n').filter(line => line && !line.startsWith('#'));
      const dockerEnvContent = lines.map(line => `ENV ${line.trim()}`);
      fs.writeFileSync(dockerEnvPath, dockerEnvContent.join('\n'));
      console.log('✅ สร้าง DockerEnv จาก fallback แล้ว');
    } else {
      console.error('❌ ไม่พบ .env.local fallback และไม่สามารถดึงจาก Vault ได้');
      process.exit(1);
    }
  }
}

fetchVaultSecrets();