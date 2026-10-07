import {createHash,randomInt} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';

function option(name,fallback=''){
  const index=process.argv.indexOf(`--${name}`);
  return index>=0?process.argv[index+1]:fallback;
}

const company=option('company');
const quantity=Number(option('quantity','0'));
const days=Number(option('days','365'));
const activateBy=option('activate-by');
const batchName=option('name',`${company} ${new Date().toISOString().slice(0,10)}`);
const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY;

if(!url||!secret||!company||!Number.isInteger(quantity)||quantity<1||quantity>5000||!activateBy){
  console.error('Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run generate-codes -- --company "Företag AB" --quantity 100 --days 365 --activate-by 2027-12-31');
  process.exit(1);
}

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makePart=()=>Array.from({length:4},()=>alphabet[randomInt(alphabet.length)]).join('');
const makeCode=()=>`KAVOR-${makePart()}-${makePart()}-${makePart()}`;
const normalize=code=>code.toUpperCase().replace(/[^A-Z0-9]/g,'');
const hash=code=>createHash('sha256').update(normalize(code),'utf8').digest('hex');
const supabase=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const {data:batch,error:batchError}=await supabase.from('activation_batches').insert({
  name:batchName,company_name:company,quantity,license_days:days,activate_by:new Date(`${activateBy}T23:59:59Z`).toISOString()
}).select('id').single();
if(batchError)throw batchError;

const rawCodes=new Set();
while(rawCodes.size<quantity)rawCodes.add(makeCode());
const rows=[...rawCodes].map(code=>({batch_id:batch.id,code_hash:hash(code),code_suffix:normalize(code).slice(-4)}));
for(let start=0;start<rows.length;start+=500){
  const {error}=await supabase.from('activation_codes').insert(rows.slice(start,start+500));
  if(error)throw error;
}

await mkdir('generated',{recursive:true});
const csv=['code,activation_url,status',...[...rawCodes].map(code=>`${code},https://kavor.se/activate.html#code=${code},unused`)].join('\n')+'\n';
const filename=`generated/${company.toLowerCase().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')}-${batch.id}.csv`;
await writeFile(filename,csv,{mode:0o600});
console.log(`Created ${quantity} codes in batch ${batch.id}.`);
console.log(`Saved the only plain-text copy to ${filename}. Store it securely.`);
