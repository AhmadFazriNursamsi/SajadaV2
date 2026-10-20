// Monorepo: Expo SDK 57 mendeteksi workspace otomatis; paket @sajadah/shared dibaca dari dist-nya.
const { getDefaultConfig } = require('expo/metro-config');
module.exports = getDefaultConfig(__dirname);
