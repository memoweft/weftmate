/* Native authentication forwards to the existing cloud journey and Android account dispatcher. */
(() => {
  const n=WeftUiCore.nativePresentation,{view,section,text,input,action,navigate}=n;
  const auth=c=>c.accountCore.cloudAuthView();
  n.register('login',{
    async read(c){if(!['login','registration','recovery','code-login','confirm'].includes(auth(c).mode))c.accountCore.startCloudJourney('login');const s=auth(c);const code=s.step==='code',password=s.step==='password',other=['registration','recovery','code-login'].includes(s.mode);
      const title={registration:'注册 WeftMate',recovery:'找回密码',confirm:'确认是你在登录'}[s.mode]||'登录 WeftMate';
      return view(title,[
        section('',[text('登录同一个账号，让手机和电脑接着聊。'),s.error?text(s.error):null,
          code?text(s.email,'请输入邮箱收到的验证码。'):null,
          code?input('code','邮箱验证码'):password?input('password',s.mode==='recovery'?'新密码':'设置密码','',{secret:true}):input('email','邮箱',s.email),
          code?null:password?input('confirmation','确认密码','',{secret:true}):!other?input('password','密码','',{secret:true}):null,
          password&&s.mode==='registration'?input('deviceName','设备名称',s.deviceName||'这台手机'):null,
          action(code?'验证邮箱':password?'保存密码':other?'发送验证码':'登录','submit',{}, {primary:true,enabled:!s.busy&&!s.retrySeconds}),
          code&&s.mode!=='confirm'?action(s.resendSeconds?`${s.resendSeconds} 秒后可重发`:'重新发送验证码','resend',{}, {enabled:!s.resendSeconds}):null]),
        section('其他方式',[
          s.mode!=='login'?action('返回密码登录','mode',{mode:'login'}):null,
          !other&&!code&&!password&&s.codeLoginSupported?action('用邮箱验证码登录','mode',{mode:'code-login'}):null,
          s.mode==='login'?action('注册账号','mode',{mode:'registration'}):null,
          s.mode==='login'?action('忘记密码','mode',{mode:'recovery'}):null,
          navigate('电脑账户与连接','connect'),navigate('服务条款','legal',{kind:'terms'}),navigate('隐私政策','legal',{kind:'privacy'})])],{identity:s.mode+':'+s.step,refreshAfterMs:s.resendSeconds||s.retrySeconds?1000:0});
    },
    async act(c,id,p,v){const s=auth(c),core=c.accountCore;
      if(id==='mode')core.startCloudJourney(p.mode);
      else if(id==='resend')await core.cloudRequestCode();
      else if(id==='submit'){
        if(s.step==='code')await core.cloudVerifyCode(v.code||'');
        else if(s.step==='password')await core.cloudComplete({password:v.password||'',confirmation:v.confirmation||'',deviceName:v.deviceName||'这台手机'});
        else if(['registration','recovery','code-login'].includes(s.mode))await core.cloudRequestCode(v.email||'');
        else await core.cloudLogin({email:v.email||'',password:v.password||''});
      }
      if(auth(c).mode==='authenticated'){await c.adoptCloud();return {authenticated:true,effect:{kind:'authenticated'}};}
      return {};
    },
  });
  n.register('connect',{
    async read(c){const boot=await c.call('app.bootstrap');return view('电脑账户与连接',[
      section('WeftMate 账号',[text(boot.loggedIn?'账号已登录':'还没有登录账号'),navigate('邮箱登录','login')]),
      boot.loggedIn?section('连接电脑',[input('pairing','配对码'),action('连接并入组','pairing',{}, {primary:true}),action('拍摄或选择电脑二维码','scanPairing'),action('检查账户连接','check')]):null,
      section('个人服务',[input('origin','个人服务地址',boot.origin||'https://home.weftmate.top:8443'),input('username','账户名'),input('password','密码','',{secret:true}),input('deviceName','设备名称','这台手机'),input('displayName','昵称'),action('检查服务连接','probe'),action('登录个人服务','personalLogin'),action('注册个人服务账户','personalRegister')])]);},
    async act(c,id,p,v){
      if(id==='check'){await c.call('auth.me');return {message:'账户已核对'};}
      if(id==='probe'){const s=await c.call('auth.state',{origin:v.origin});return {message:s.registrationAvailable?'可以登录或注册账户。':'服务已有账户，请登录。'};}
      if(id==='pairing'||id==='scanPairing'){const code=p.qrCode||v.pairing;await c.accountCore.cloudRedeemPairing(code||'');await c.adoptCloud();return {authenticated:true,effect:{kind:'authenticated'}};}
      if(id==='personalLogin'||id==='personalRegister'){const result=await c.call(id==='personalLogin'?'auth.login':'auth.register',v);await c.adoptPersonal(result);return {authenticated:true,effect:{kind:'authenticated'}};}
      throw Error('请重新打开连接页面。');
    },
  });
  n.register('account',{
    async read(c){const a=auth(c),identity=await c.call('phone.identity').catch(()=>({}));return view('账户保护',[
      section('当前账号',[text(a.email||identity.email||'这台设备的账户'),text('账号钥匙',identity.accountKeyId?'这台设备已持有账号钥匙。':'可以用原持钥设备的入组码添加这台设备。'),navigate('扫码入组与电脑连接','connect'),navigate('修改密码','accountPassword'),navigate('换绑邮箱','accountEmail')]),
      section('其他设备',[action('退出所有其他设备','logoutOthers',{}, {confirm:'其他设备需要重新登录，当前设备继续可用。'})]),
      section('注销云账号',[text('注销后需要重新注册，电脑上的本机数据另行管理。'),input('password','云账号密码','',{secret:true}),action('注销云账号','deleteAccount',{}, {danger:true,confirm:'确认注销当前云账号？这会移除账号身份和设备连接，无法撤销。'})])]);},
    async act(c,id,p,v){if(id==='logoutOthers'){await c.accountCore.cloudLogoutOthers();return {message:'其他设备已退出'};}if(id==='deleteAccount'){await c.accountCore.cloudDeleteAccount(v.password||'');return {authenticated:true,effect:{kind:'authenticated'}};}throw Error('请重新打开账户。');},
  });
  n.register('profile',{
    async read(c){const p=await c.call('auth.me');return view('账户资料',[section('',[input('displayName','昵称',p.displayName||''),action('保存昵称','save',{revision:p.profileRevision},{primary:true}),action('更换头像','photo'),p.avatar?action('移除头像','removePhoto',{revision:p.profileRevision},{confirm:'移除当前头像？昵称和对话保留。'}):null])]);},
    async act(c,id,p,v){if(id==='photo'){await c.call('auth.chooseAvatar');return {message:'请从系统照片中选择头像'};}const profile=await c.call('auth.profile',{expectedRevision:p.revision,...(id==='removePhoto'?{avatar:null}:{displayName:v.displayName})});c.state.profile=profile;return {message:'资料已保存',resetValues:true};},
  });
  n.register('accountPassword',{
    async read(){return view('修改密码',[section('',[input('currentPassword','当前密码','',{secret:true}),input('password','新密码','',{secret:true}),input('confirmation','再次填写新密码','',{secret:true}),action('保存新密码','save',{}, {primary:true})])]);},
    async act(c,id,p,v){await c.accountCore.cloudChangePassword(v.currentPassword||'',v.password||'',v.confirmation||'');return {authenticated:true,effect:{kind:'authenticated'}};},
  });
  n.register('accountEmail',{
    async read(c,p){return view('换绑邮箱',[section('',[input('email','新邮箱'),action('发送验证码','send'),input('code','验证码'),action('确认换绑','confirm',{}, {primary:true})])]);},
    async act(c,id,p,v){if(id==='send'){await c.accountCore.cloudEmailRequest(v.email||'');return {message:'验证码已发送'};}await c.accountCore.cloudEmailConfirm(v.code||'');return {authenticated:true,effect:{kind:'authenticated'}};},
  });
})();
