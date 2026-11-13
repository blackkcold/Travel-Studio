import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
const packages=[];
for(const [location,entry] of Object.entries(lock.packages)){
  if(!location||entry.dev||!location.startsWith('node_modules/'))continue;
  const directory=path.join(root,location);
  let metadata;
  try{metadata=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));}catch{continue;}
  const names=(await fs.readdir(directory)).sort();
  const licenseFiles=names.filter(name=>/^(licen[cs]e|copying|notice|ofl)([.-]|$)/i.test(name));
  const texts=[];
  for(const name of licenseFiles){const file=path.join(directory,name);if((await fs.stat(file)).isFile())texts.push({name,text:(await fs.readFile(file,'utf8')).trim()});}
  if(!texts.length){
    for(const name of names.filter(name=>/^readme([.-]|$)/i.test(name))){
      const text=await fs.readFile(path.join(directory,name),'utf8');
      const start=text.search(/^#+\s+licen[cs]e\b/im);
      if(start>=0&&/permission is hereby granted|redistribution and use|sil open font license/i.test(text.slice(start)))texts.push({name:`${name} — license section`,text:text.slice(start).trim()});
    }
  }
  const license=typeof metadata.license==='string'?metadata.license:metadata.license?.type??'See included notice';
  if(!texts.length)throw new Error(`No distribution notice found for ${metadata.name}@${metadata.version}`);
  const key=`${metadata.name}@${metadata.version}`;
  if(!packages.some(item=>item.key===key))packages.push({key,name:metadata.name,version:metadata.version,license,texts});
}
packages.sort((a,b)=>a.key.localeCompare(b.key,'en'));
let output='# Third-party distribution notices\n\nGenerated from the exact installed production dependency graph and its original notice files. Build-only dependencies are excluded. Font packages include their font licenses. Online map datasets and services have separate attribution and policies in [PROVIDERS.md](PROVIDERS.md).\n\n';
output+='| Package | Version | Declared license |\n| --- | --- | --- |\n';
for(const item of packages)output+=`| ${item.name} | ${item.version} | ${item.license} |\n`;
for(const item of packages){output+=`\n## ${item.key}\n\n`;for(const notice of item.texts)output+=`### ${notice.name}\n\n\`\`\`text\n${notice.text}\n\`\`\`\n\n`;}
const destination=path.join(root,'docs/THIRD_PARTY_NOTICES.md');
if(process.argv.includes('--check')){
  if(await fs.readFile(destination,'utf8')!==output)throw new Error('Third-party notices differ from the installed release dependency graph. Run npm run licenses.');
}else await fs.writeFile(destination,output);
console.log(`Verified notices for ${packages.length} production dependencies.`);
