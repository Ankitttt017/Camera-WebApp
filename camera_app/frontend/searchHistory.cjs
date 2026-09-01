const fs = require('fs');
const path = require('path');

function search(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      search(fullPath);
    } else {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('export default function App') && content.includes('DOWNTIME_TYPES') && content.includes('Voice Transcript')) {
          console.log(fullPath);
          fs.copyFileSync(fullPath, 'C:\\Users\\Admin\\OneDrive - ricoauto.in\\Desktop\\Live_Project\\Camera-WebApp\\camera_app\\frontend\\src\\App.tsx.recovered');
          console.log('Recovered!');
          process.exit(0);
        }
      } catch (e) {}
    }
  }
}
search(process.env.APPDATA + '\\Code\\User\\History');
