const required = [
  'TELEGRAM_BOT_TOKEN',
  'OPENROUTER_API_KEY',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const year = new Date().getFullYear();
const spreadsheetIdKey = `GOOGLE_SPREADSHEET_ID_${year}`;
if (!process.env[spreadsheetIdKey]) {
  console.error(`Missing required env var: ${spreadsheetIdKey}`);
  process.exit(1);
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  getSpreadsheetId(year) {
    const id = process.env[`GOOGLE_SPREADSHEET_ID_${year}`];
    if (!id) throw new Error(`Missing env var: GOOGLE_SPREADSHEET_ID_${year}`);
    return id;
  },
};
