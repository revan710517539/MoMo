import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
if(process.platform==='darwin'){
 mkdirSync('build',{recursive:true});
 const result=spawnSync('xcrun',['swiftc','-O','electron/observer-macos.swift','-o','build/momo-observer'],{stdio:'inherit'});
 if(result.error||result.status!==0){console.error('无法构建本机应用观察组件，请安装 Apple Command Line Tools。');process.exit(1);}
 console.log('macOS observation helper built (application name only)');
}
