// Menambahkan google-services.json (Firebase/FCM, untuk push Android) hanya bila tersedia:
// di EAS lewat variabel berkas GOOGLE_SERVICES_JSON, atau berkas lokal ./google-services.json.
const fs = require('node:fs');

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync('./google-services.json') ? './google-services.json' : null);
  return file ? { ...config, android: { ...config.android, googleServicesFile: file } } : config;
};
