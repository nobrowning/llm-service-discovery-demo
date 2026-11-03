import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('vendor/manifest.json',root),'utf8'));
for(const component of manifest.components){
  if(!/^[a-z0-9.-]+\.tgz$/.test(component.file))throw new Error('Invalid component artifact name');
  const bytes=await readFile(new URL(`vendor/${component.file}`,root));
  if(createHash('sha256').update(bytes).digest('hex')!==component.sha256)throw new Error(`Component digest mismatch: ${component.name}`);
  const installed=JSON.parse(await readFile(new URL(`node_modules/${component.name}/package.json`,root),'utf8'));
  if(installed.name!==component.name||installed.version!==component.version)throw new Error(`Installed component version mismatch: ${component.name}`);
  console.log(`Verified ${component.name}@${component.version}`);
}
