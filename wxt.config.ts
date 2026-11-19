import { defineConfig } from 'wxt';
import { PINTEREST_MATCHES, IMAGE_HOSTS } from './lib/domains';

// The public key pins the extension ID (mkbabhikjbjlgcchkjmilpbfnliogiin), so settings
// survive updates even when the unpacked folder moves.
const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqjcVH+d4aUxgZBU82pz5ClzSfqY/oqfutIRsdQ8mkNa7kee1hagmyRp54VqT7A+PQGI4FCeKAX3PuPww2DDixGNHrip8uHki5rrMMn4geWcKsuuVIuGMz5m90ieC92Sn071ydHE2sBl2EZofH41pI8hvycvZFhZk0QOL5AG4p/Ai7skY9bE6mrNEiXFgvRZjQBMkfmeA+6sVMZnZv7ysPGgkS2ymvDX4qMndsFsw7U7oMVP+ThwVdctAdnuNYwy6B1vpIlIAvDDj3ZfmP5YFmWiFSbkm4tLdBkpx/aaMRRx45SS8FaFAx3Xz62NhBpcf6xwE+Q+nHCRuiAT62ncbfwIDAQAB';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Pinterest Heist',
    description: 'Download Pinterest pins, boards and sections at full resolution, and hand references to PureRef.',
    key: KEY,
    permissions: ['downloads', 'storage', 'scripting', 'offscreen', 'clipboardWrite'],
    host_permissions: [...PINTEREST_MATCHES, ...IMAGE_HOSTS],
    action: {
      default_title: 'Pinterest Heist: click to turn on or off (Alt+Shift+H)',
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+H' },
        description: 'Turn Pinterest Heist on or off on this tab',
      },
    },
  },
});
