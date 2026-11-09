// Loads the app's Supabase settings from ../.env.local for local scripts.
//
// Only the project below is accepted, so these scripts can't reach the old
// ListdPro database by accident. Change it deliberately if the project changes.
const { parseEnv } = require('node:util')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const APP_PROJECT_REF = 'qflhjivpwgujfliqalvt'
const web = path.resolve(__dirname, '../..')

// The saved password contains literal % characters, written unescaped in the
// URL. URL parsers would decode them and send the wrong password, so escape them.
function encodePassword(value) {
  const u = new URL(value)
  if (!u.password.includes('%25')) u.password = encodeURIComponent(u.password)
  return u.toString()
}

function loadAppEnv() {
  const file = parseEnv(readFileSync(path.resolve(web, '../.env.local'), 'utf8'))
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    if (!file[name]) throw new Error(`${name} is missing from .env.local`)
    if (new URL(file[name]).username.split('.')[1] !== APP_PROJECT_REF) {
      throw new Error(`Refusing to run: ${name} does not point at project ${APP_PROJECT_REF}`)
    }
  }
  if (new URL(file.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${APP_PROJECT_REF}.supabase.co`) {
    throw new Error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not project ${APP_PROJECT_REF}`)
  }
  return {
    ...file,
    DATABASE_URL: encodePassword(file.DATABASE_URL),
    DIRECT_URL: encodePassword(file.DIRECT_URL),
    SUPABASE_SERVICE_ROLE_KEY: file.SUPABASE_SECRET_KEY,
  }
}

module.exports = { APP_PROJECT_REF, loadAppEnv, web }
