  let{open:t,initialMode:initMode,intentName:n,prefill:pf,onOpenChange:r,onJoined:i}=e,
  [mode,setMode]=(0,c.useState)(initMode||"login"),
  [loginStep,setLoginStep]=(0,c.useState)("input"), /* "input" | "otp" | "password" */
  [o,a]=(0,c.useState)(1), /* Sign-Up steps 1, 2, 3, 4 (email code) */
  [profileFor,setProfileFor]=(0,c.useState)("self"),
  [l,s]=(0,c.useState)(""), /* fullName */
  [d,h]=(0,c.useState)("man"), /* gender */
  [f,p]=(0,c.useState)("woman"), /* seeking */
  [age,setAge]=(0,c.useState)("27"),
  [marital,setMarital]=(0,c.useState)("Never Married"),
  [m,g]=(0,c.useState)("srivastava"), /* kulId */
  [v,y]=(0,c.useState)(""), /* gotra */
  [x,b]=(0,c.useState)(""), /* city */
  [profession,setProfession]=(0,c.useState)(""),
  [w,S]=(0,c.useState)(""), /* email */
  [k,A]=(0,c.useState)(""), /* phone */
  [E,C]=(0,c.useState)(""), /* password */
  [T,M]=(0,c.useState)(!1), /* show password */
  [stayLogged,setStayLogged]=(0,c.useState)(!0),
  [j,R]=(0,c.useState)(pV),
  [P,I]=(0,c.useState)(!1), /* loading */
  [D,O]=(0,c.useState)(""), /* error */
  [info,setInfo]=(0,c.useState)(""), /* success message */
  [loginId,setLoginId]=(0,c.useState)(""), /* Email ID in the login box */
  [otpDigits,setOtpDigits]=(0,c.useState)(["","","","","",""]),
  [authed,setAuthed]=(0,c.useState)(null), /* signed in with Google / OTP but profile not filled in yet */
  [otpNotice,setOtpNotice]=(0,c.useState)(""),
  [resendTimer,setResendTimer]=(0,c.useState)(0),
  digitRefs=(0,c.useRef)([]);

  const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE=/^[6-9]\d{9}$/;

  (0,c.useEffect)(()=>{
    if(initMode) setMode(initMode);
  },[initMode,t]);

  (0,c.useEffect)(()=>{
    if(pf){
      if(pf.seeking){
        p(pf.seeking);
        h(pf.seeking==="woman"?"man":"woman");
      }
      if(pf.kulId&&pf.kulId!=="all") g(pf.kulId);
      if(pf.city&&pf.city!=="all") b(pf.city);
    }
  },[pf]);

  (0,c.useEffect)(()=>{
    if(resendTimer<=0) return;
    let tm=window.setTimeout(()=>setResendTimer(x=>x-1),1000);
    return()=>window.clearTimeout(tm);
  },[resendTimer]);

  function V(){
    a(1);R(pV);O("");setInfo("");I(!1);setLoginStep("input");setOtpDigits(["","","","","",""]);setOtpNotice("");setAuthed(null);
  }

  function fb(){
    if(!window.chitranshFirebase||!window.chitranshFirebase.ready) throw new Error("Sign-in is still loading. Please try again in a moment.");
    return window.chitranshFirebase;
  }

  function msg(err,fallback){
    return err&&err.message?err.message:fallback;
  }

  function handleProfileForSelect(opt){
    setProfileFor(opt.id);
    if(opt.gender) h(opt.gender);
    if(opt.seeking) p(opt.seeking);
  }

  function handleDigitChange(idx,val){
    let digits=String(val||"").replace(/\D/g,"");
    let next=[...otpDigits];
    if(digits.length>1){ /* pasted the whole code */
      for(let q=0;q<digits.length&&idx+q<6;q++) next[idx+q]=digits[q];
      setOtpDigits(next);
      let last=Math.min(idx+digits.length,5);
      if(digitRefs.current[last]) digitRefs.current[last].focus();
      return;
    }
    next[idx]=digits;
    setOtpDigits(next);
    if(digits&&idx<5&&digitRefs.current[idx+1]){
      digitRefs.current[idx+1].focus();
    }
  }

  function handleDigitKeyDown(idx,ev){
    if(ev.key==="Backspace"&&!otpDigits[idx]&&idx>0&&digitRefs.current[idx-1]){
      digitRefs.current[idx-1].focus();
    }
  }

  /* After Google / OTP / password sign-in: enter the house, or finish the profile first */
  async function afterAuth(res){
    if(!res) return;
    if(res.needsProfile){
      setAuthed(res);
      if(res.fullName) s(res.fullName);
      if(res.email) S(res.email);
      setLoginStep("input");setOtpDigits(["","","","","",""]);setOtpNotice("");O("");setInfo("");
      setMode("signup");a(1);
      return;
    }
    await i(res);
    V();
    C("");
  }

  async function handleGoogleClick(){
    I(!0);O("");setInfo("");
    try{
      let api=fb();
      await api.setRemember(stayLogged);
      await afterAuth(await api.signInWithGoogle());
    }catch(err){
      O(msg(err,"Google sign-in could not complete. Please try again."));
    }finally{
      I(!1);
    }
  }

  function loginEmailOrError(){
    let raw=loginId.trim().toLowerCase();
    if(!raw){O("Please enter your Email ID.");return null;}
    if(!raw.includes("@")&&/^[+\d][\d\s-]*$/.test(raw)){O("Mobile OTP is coming soon. Please use your Email ID for now.");return null;}
    if(!EMAIL_RE.test(raw)){O("Please enter a valid Email ID.");return null;}
    return raw;
  }

  /* "Login with OTP": email a 6-digit code */
  async function startLoginWithOtp(ev){
    if(ev&&ev.preventDefault) ev.preventDefault();
    O("");setInfo("");
    let email=loginEmailOrError();
    if(!email) return;
    I(!0);
    try{
      let api=fb();
      await api.setRemember(stayLogged);
      let res=await api.sendOtp(email);
      setOtpDigits(["","","","","",""]);
      setResendTimer(res&&res.resendInSec?res.resendInSec:30);
      setOtpNotice(res&&res.notice?res.notice:"We've sent a 6-digit code to "+email+".");
      setLoginStep("otp");
    }catch(err){
      if(err&&err.retryAfter) setResendTimer(err.retryAfter);
      O(msg(err,"Could not send the code. Please try again."));
    }finally{
      I(!1);
    }
  }

  /* Check the 6-box code in Login mode */
  async function verifyLoginOtp(ev){
    ev.preventDefault();
    O("");
    let entered=otpDigits.join("");
    if(!/^\d{6}$/.test(entered)){
      O("Please enter all 6 digits of the code.");
      return;
    }
    I(!0);
    try{
      let res=await fb().verifyOtp({target:loginId.trim().toLowerCase(),isEmail:!0,enteredCode:entered});
      await afterAuth(res);
    }catch(err){
      O(msg(err,"That code didn't work. Please try again."));
    }finally{
      I(!1);
    }
  }

  /* "Login with Password" */
  async function submitPasswordLogin(ev){
    ev.preventDefault();
    O("");setInfo("");
    let email=loginId.trim().toLowerCase();
    if(!email){O("Please enter your Email ID.");return;}
    if(!EMAIL_RE.test(email)){O(/^[+\d][\d\s-]*$/.test(email)?"Password login uses your Email ID. Please enter your email.":"Please enter a valid Email ID.");return;}
    if(!E){O("Please enter your password.");return;}
    I(!0);
    try{
      let api=fb();
      await api.setRemember(stayLogged);
      await afterAuth(await api.signInWithEmail({email:email,password:E}));
    }catch(err){
      O(msg(err,"Could not log in. Please try again."));
    }finally{
      I(!1);
    }
  }

  async function forgotPassword(){
    O("");setInfo("");
    I(!0);
    try{
      await fb().resetPassword(loginId);
      setInfo("If an account exists for "+loginId.trim().toLowerCase()+", we've emailed a link to reset the password. Check your spam folder too.");
    }catch(err){
      O(msg(err,"Could not send the reset email. Please try again."));
    }finally{
      I(!1);
    }
  }

  /* Validate Sign-Up Wizard Steps */
  function validateSignupStep(step){
    let errs={};
    if(1===step){
      if(l.trim().length<2) errs.fullName="Please enter the full name of the candidate.";
      if("woman"!==d&&"man"!==d) errs.gender="Please select Bride (Woman) or Groom (Man).";
    }
    if(2===step){
      if(!pD.some(e=>e.id===m)) errs.kulId="Please choose a Kayastha Kul.";
      if(v.trim().length<2) errs.gotra="Please enter or select a Gotra.";
      if(x.trim().length<2) errs.city="Please enter the city.";
    }
    if(3===step){
      if(!EMAIL_RE.test(w.trim())) errs.email="Enter a valid Email ID.";
      if(!PHONE_RE.test(pN(k))) errs.phone="Enter a 10-digit Indian Mobile Number.";
      if(!authed&&E.length<6) errs.password="Create a password of at least 6 characters.";
    }
    R(errs);
    return 0===Object.keys(errs).length;
  }

  function buildProfile(){
    return{
      fullName:l.trim().replace(/\s+/g," "),
      email:w.trim().toLowerCase(),
      phone:pN(k),
      gender:d,
      seeking:d==="woman"?"man":"woman",
      kulId:m,
      gotra:v.trim(),
      city:x.trim(),
      age:String(age),
      maritalStatus:marital,
      profession:profession.trim(),
      profileFor:profileFor
    };
  }

  /* Step 3 -> Step 4: email a code to verify the new account (or save the profile if already signed in) */
  async function startSignupOtp(){
    if(!validateSignupStep(3)) return;
    I(!0);O("");setInfo("");
    try{
      let api=fb();
      if(authed){
        let member=await api.saveProfile({...buildProfile(),email:authed.email||w.trim().toLowerCase(),authMethod:authed.authMethod||"Verified"});
        await i(member);
        V();
        return;
      }
      await api.setRemember(stayLogged);
      let res=await api.sendOtp(w.trim().toLowerCase());
      setOtpDigits(["","","","","",""]);
      setResendTimer(res&&res.resendInSec?res.resendInSec:30);
      setOtpNotice(res&&res.notice?res.notice:"We've sent a 6-digit code to "+w.trim()+".");
      a(4);
    }catch(err){
      if(err&&err.retryAfter) setResendTimer(err.retryAfter);
      O(msg(err,"Could not continue. Please try again."));
    }finally{
      I(!1);
    }
  }

  async function resendSignupOtp(){
    O("");
    I(!0);
    try{
      let res=await fb().sendOtp(w.trim().toLowerCase());
      setOtpDigits(["","","","","",""]);
      setResendTimer(res&&res.resendInSec?res.resendInSec:30);
      setOtpNotice(res&&res.notice?res.notice:"We've sent a new code.");
    }catch(err){
      if(err&&err.retryAfter) setResendTimer(err.retryAfter);
      O(msg(err,"Could not send the code. Please try again."));
    }finally{
      I(!1);
    }
  }

  /* Step 4: check the email code, create the account, save the profile */
  async function completeSignupWithOtp(ev){
    ev.preventDefault();
    O("");
    let entered=otpDigits.join("");
    if(!/^\d{6}$/.test(entered)){
      O("Please enter the 6-digit code from your email.");
      return;
    }
    I(!0);
    try{
      let member=await fb().registerWithEmailOtp({email:w.trim().toLowerCase(),code:entered,password:E,profile:buildProfile()});
      await i(member);
      V();
      C("");
    }catch(err){
      O(msg(err,"Registration could not complete. Please try again."));
    }finally{
      I(!1);
    }
  }

