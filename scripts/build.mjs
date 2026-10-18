import { build } from 'esbuild';
import { mkdir,copyFile,writeFile,cp } from 'node:fs/promises';

await mkdir('dist',{recursive:true});
for(const file of ['index.html','styles.css'])await copyFile(`static/${file}`,`dist/${file}`);
await build({entryPoints:['static/app.js'],bundle:true,format:'esm',target:'es2022',outdir:'dist',splitting:true,minify:true,legalComments:'linked',chunkNames:'chunks/[name]-[hash]'});
await copyFile('public/test-bills/bills/BB-21.pdf','dist/sample-bill.pdf');
await cp('public/test-bills','dist/test-bills',{recursive:true});
await writeFile('dist/_headers',`/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'\n`);
console.log('Built Bill Buster assets. PDF reading and checks run locally; optional AI drafting uses the Worker API.');
