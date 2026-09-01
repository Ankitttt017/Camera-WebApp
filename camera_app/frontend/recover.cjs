const fs = require('fs');
const readline = require('readline');

async function extract() {
  const fileStream = fs.createReadStream('C:\\Users\\Admin\\.gemini\\antigravity-ide\\brain\\142dc98d-77ce-45e6-958c-c12ef8235dd4\\.system_generated\\logs\\transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.includes('Total Lines: 2503')) {
      const obj = JSON.parse(line);
      if (obj.content && obj.content.includes('App.tsx')) {
        fs.writeFileSync('C:\\Users\\Admin\\OneDrive - ricoauto.in\\Desktop\\Live_Project\\Camera-WebApp\\camera_app\\frontend\\src\\App.tsx.backup', obj.content);
        console.log('Found and extracted to App.tsx.backup');
        return;
      }
    }
  }
  console.log('Not found');
}
extract();
