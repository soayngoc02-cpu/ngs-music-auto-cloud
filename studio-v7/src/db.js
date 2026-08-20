import pg from 'pg';
import crypto from 'crypto';
const {Pool}=pg;
export const DATABASE_URL=process.env.DATABASE_URL||'';
export const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}}):null;
export const APP_SECRET=process.env.APP_SECRET||crypto.createHash('sha256').update((DATABASE_URL||'ngs-dev')+':ngs-v7').digest('hex');
const ENC_KEY=crypto.createHash('sha256').update(APP_SECRET+':settings').digest();
export const newid=()=>crypto.randomUUID();
export const nowIso=()=>new Date().toISOString();
export async function q(text,params=[]){if(!pool)throw new Error('DATABASE_URL chưa được cấu hình');return pool.query(text,params)}
function encrypt(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',ENC_KEY,iv);const data=Buffer.concat([c.update(String(value),'utf8'),c.final()]);return [iv.toString('hex'),c.getAuthTag().toString('hex'),data.toString('base64')].join(':')}
function decrypt(value){if(!value)return'';const [iv,tag,data]=String(value).split(':');const d=crypto.createDecipheriv('aes-256-gcm',ENC_KEY,Buffer.from(iv,'hex'));d.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString('utf8')}
export async function getSetting(key){const r=await q('select value,secret from app_settings where key=$1',[key]);if(!r.rowCount)return'';return r.rows[0].secret?decrypt(r.rows[0].value):r.rows[0].value}
export async function setSetting(key,value,secret=true){const stored=secret?encrypt(value):String(value);await q(`insert into app_settings(key,value,secret,updated_at) values($1,$2,$3,now()) on conflict(key) do update set value=excluded.value,secret=excluded.secret,updated_at=now()`,[key,stored,secret])}
export function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return{salt,hash:crypto.scryptSync(String(password),salt,64).toString('hex')}}
export function verifyPassword(password,salt,expected){const a=crypto.scryptSync(String(password),salt,64),b=Buffer.from(expected,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}
export async function audit(actor,action,target='',detail={}){try{await q('insert into audit_logs(id,actor_id,action,target,detail,created_at) values($1,$2,$3,$4,$5,now())',[newid(),actor||null,action,target,detail])}catch{}}
export async function initDb(){if(!pool)return;await q(`
create table if not exists users(id text primary key,email text unique not null,password_hash text not null,salt text not null,role text not null check(role in ('SUPER_ADMIN','ADMIN','USER')),active boolean not null default true,created_by text,created_at timestamptz default now(),updated_at timestamptz default now());
create table if not exists app_settings(key text primary key,value text not null,secret boolean not null default true,updated_at timestamptz default now());
create table if not exists media(id text primary key,owner_id text references users(id) on delete set null,kind text not null,name text not null,mime text not null,data bytea not null,meta jsonb not null default '{}'::jsonb,shared boolean default true,created_at timestamptz default now());
create table if not exists projects(id text primary key,owner_id text references users(id) on delete set null,title text not null,idea text not null default '',duration integer not null default 20,music_mode text not null default 'auto',status text default 'queued',progress integer default 0,message text default '',plan jsonb,music_id text references media(id) on delete set null,output_media_id text references media(id) on delete set null,error text,created_at timestamptz default now(),updated_at timestamptz default now());
create table if not exists audit_logs(id text primary key,actor_id text,action text not null,target text,detail jsonb not null default '{}'::jsonb,created_at timestamptz default now());`)}
