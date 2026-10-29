"""Apply the sign-in fixes to the exported Chitransh site.

usage: python3 patch_site.py <original-export-dir> <output-dir>

- index.html: replaces the inline Firebase helper (window.chitranshFirebase) with tools/auth-helper.js
- the login chunk: replaces the sign-in/sign-up logic with tools/login-logic.js and patches the screens
Every replacement checks how many times its anchor occurs, so a changed export fails loudly.
"""
import os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = sys.argv[1], sys.argv[2]
CHUNK = '_next/static/chunks/a170b02c18bb0d57.js'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def replace(s, old, new, count=1):
    found = s.count(old)
    if found != count:
        raise SystemExit(f'anchor found {found}x (expected {count}): {old[:80]!r}')
    return s.replace(old, new)


shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(SRC, OUT)

# ---- 1. index.html: new sign-in helper ---------------------------------------------------
html = read(os.path.join(OUT, 'index.html'))
m = re.search(r'(<script type="module">)(.*?)(</script>)', html, re.S)
if not m or 'chitranshFirebase' not in m.group(2):
    raise SystemExit('Firebase helper script not found in index.html')
cfg = re.search(r'const firebaseConfig = (\{.*?\});', m.group(2), re.S)
if not cfg:
    raise SystemExit('firebaseConfig not found')
helper = read(os.path.join(HERE, 'auth-helper.js')).replace('__FIREBASE_CONFIG__', cfg.group(1).rstrip(';'))
html = html[:m.start(2)] + helper + html[m.end(2):]
write(os.path.join(OUT, 'index.html'), html)

# ---- 2. login chunk ----------------------------------------------------------------------
path = os.path.join(OUT, CHUNK)
js = read(path)

start = js.index('  let{open:t,initialMode')
end = js.index('  let profileForPills=[')
js = js[:start] + read(os.path.join(HERE, 'login-logic.js')) + js[end:]

# Login box: email only
js = replace(js, 'label:"Mobile No. / Email ID",htmlFor:"shaadi-login-id"', 'label:"Email ID",htmlFor:"shaadi-login-id"')
js = replace(js, 'placeholder:"Enter 10-digit Mobile No. or Email ID",autoComplete:"username"',
             'inputMode:"email",placeholder:"Enter your Email ID",autoComplete:"email"')
js = replace(js, '(0,u.jsx)("button",{type:"button",onClick:()=>{if(!loginId.trim()) setLoginId("9876543210"); startLoginWithOtp();},className:"text-[#D4AF37] hover:underline",children:"Use Instant Demo OTP?"})',
             '(0,u.jsx)("span",{className:"text-[#b7ad9e]",children:"Mobile OTP coming soon"})')
# No more "Auto-Fill OTP" buttons (login and sign-up)
js = replace(js, '(0,u.jsx)("button",{type:"button",onClick:autofillOtp,className:"rounded-full bg-[#D4AF37] px-2.5 py-0.5 text-[10px] font-bold text-black uppercase hover:brightness-110",children:"Auto-Fill OTP ("+generatedOtp+")"})',
             'null', count=2)
# Code boxes accept a pasted code and the phone's one-time-code autofill
js = replace(js, 'maxLength:1,', 'maxLength:6,autoComplete:"one-time-code",', count=2)
js = replace(js, '"← Change Mobile / Email"', '"← Change Email"')

# Password login: email only, plus Forgot password and a success message
js = replace(js, 'label:"Mobile No. / Email ID",htmlFor:"pw-login-id"', 'label:"Email ID",htmlFor:"pw-login-id"')
js = replace(js, 'placeholder:"Enter Email ID or 10-digit Mobile No."', 'inputMode:"email",autoComplete:"email",placeholder:"Enter your Email ID"')
lines = js.split('\n')
i = next(n for n, l in enumerate(lines) if 'children:P?"Signing in…":"Login"})' in l)
indent = re.match(r'\s*', lines[i]).group(0)
lines[i:i] = [
    indent + '(0,u.jsx)("button",{type:"button",disabled:P,onClick:forgotPassword,className:"justify-self-end text-xs text-[#D4AF37] hover:underline disabled:opacity-50",children:"Forgot password?"}),',
    indent + 'info&&(0,u.jsx)("p",{role:"status",className:"rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200",children:info}),',
]
js = '\n'.join(lines)

# Sign-up wizard
lines = js.split('\n')
i = next(n for n, l in enumerate(lines) if '1===o&&(0,u.jsxs)("div",{className:"grid gap-4",children:[' in l)
indent = re.match(r'\s*', lines[i]).group(0)
lines.insert(i, indent + 'authed&&(0,u.jsx)("p",{role:"status",className:"rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-2 text-xs text-[#f7f1e6]",children:"Signed in as "+(authed.email||"your account")+". Please complete your profile to enter the house."}),')
js = '\n'.join(lines)
js = replace(js, 'id:"lekha-email",type:"email",value:w,onChange:e=>S(e.target.value),',
             'id:"lekha-email",type:"email",autoComplete:"email",value:w,onChange:e=>S(e.target.value),disabled:!!authed,')
js = replace(js, '(0,u.jsx)(pB,{label:"Create Password",error:j.password,htmlFor:"lekha-password"',
             '!authed&&(0,u.jsx)(pB,{label:"Create Password",error:j.password,htmlFor:"lekha-password"')
js = replace(js, 'children:P?"Sending OTP…":"Send OTP to Verify ►"',
             'children:P?(authed?"Saving…":"Sending code…"):(authed?"Save & Enter ►":"Email me a code ►")')
js = replace(js, '"Verify Your Mobile / Email"', '"Verify Your Email"')
# Resend link on the sign-up code screen (the second otpNotice is the sign-up one)
first = js.index('children:otpNotice})')
second = js.index('children:otpNotice})', first + 1)
resend = (',(0,u.jsx)("div",{className:"mt-2 text-right",children:resendTimer>0?(0,u.jsxs)("span",{className:"text-[#b7ad9e]",children:["Resend code in ",resendTimer,"s"]})'
          ':(0,u.jsx)("button",{type:"button",disabled:P,onClick:resendSignupOtp,className:"font-medium text-[#D4AF37] hover:underline disabled:opacity-50",children:"Resend code"})})')
js = js[:second] + 'children:otpNotice})' + resend + js[second + len('children:otpNotice})'):]

# App: stop inventing member details
m = re.search(r'let cleanMember=\{.*?authMethod:e\.authMethod\|\|"Verified"\n    \};', js, re.S)
if not m:
    raise SystemExit('cleanMember block not found')
js = js[:m.start()] + '''let cleanMember={
      fullName:e.fullName||"Member",
      email:e.email||"",
      phone:e.phone||"",
      gender:"woman"===e.gender||"man"===e.gender?e.gender:"man",
      seeking:"woman"===e.seeking||"man"===e.seeking?e.seeking:"woman",
      kulId:e.kulId||"srivastava",
      gotra:e.gotra||"",
      city:e.city||"",
      age:e.age||"",
      maritalStatus:e.maritalStatus||"",
      profession:e.profession||"",
      profileFor:e.profileFor||"",
      photoURL:e.photoURL||"",
      uid:e.uid||"",
      authMethod:e.authMethod||"Verified"
    };''' + js[m.end():]
js = replace(js, '"Mobile verified"', '"Mobile not added"')

# Nothing from the old demo login may survive
for bad in ['123456', 'generatedOtp', 'autofillOtp', '9876543210', '\\\\d', '\\\\s', '\\\\D']:
    if bad in js:
        raise SystemExit(f'leftover {bad!r} in login chunk')
for bad in ['123456', 'lastGeneratedOtp', 'google.member@', 'firebaseio.com']:
    if bad in html:
        raise SystemExit(f'leftover {bad!r} in index.html')

write(path, js)
print('patched', OUT)
