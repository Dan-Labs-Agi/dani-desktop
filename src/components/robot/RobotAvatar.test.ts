// @vitest-environment happy-dom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({instance:null as null | {onFailure:(error:string)=>void;onReady:(ready:boolean)=>void},unregister:vi.fn()}));
vi.mock('./robot-avatar-engine',()=>({greetAvatar:vi.fn(),inferRobotRole:()=> 'dani',motionDuration:()=>0,motionFromState:()=> 'idle',pokeAvatar:vi.fn(),registerAvatar:(instance:typeof f.instance)=>{f.instance=instance;return f.unregister;},resolveRobotColor:()=> '#abcdef',seedFromLabel:()=>1}));
import {RobotAvatar} from './RobotAvatar';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();f.instance=null;});
const mount=()=>act(()=>root.render(createElement(RobotAvatar,{label:'Dani',size:132})));
it('normal WebGL path stays unchanged and does not load a static image',()=>{mount();act(()=>f.instance!.onReady(true));expect(host.querySelector('[data-robot-renderer="webgl"]')).not.toBeNull();expect(host.querySelector('img')).toBeNull();expect(host.textContent).not.toContain('unavailable');});
it('actual WebGL failure uses only the existing approved asset, keeps failure evidence and marks static only after load',()=>{mount();act(()=>f.instance!.onFailure('WebGL context could not start'));const avatar=host.querySelector('[data-robot-renderer]')!;const img=host.querySelector('img')!;expect(img.getAttribute('src')).toBe('/app-icon-512.png');expect(avatar.getAttribute('data-robot-renderer')).toBe('loading');act(()=>img.dispatchEvent(new Event('load')));expect(avatar.getAttribute('data-robot-renderer')).toBe('static-fallback');expect(avatar.getAttribute('data-robot-error')).toContain('WebGL');expect(avatar.getAttribute('aria-label')).toContain('Static Dani image; 3D avatar unavailable');expect(host.textContent).not.toContain('3D unavailable');expect(host.querySelector('.mz-robot-error')).toBeNull();});
it('broken fallback fails visibly and never reports usable rendering',()=>{mount();act(()=>f.instance!.onFailure('no WebGL'));act(()=>host.querySelector('img')!.dispatchEvent(new Event('error')));expect(host.querySelector('[data-robot-renderer="unavailable"]')).not.toBeNull();expect(host.textContent).toContain('Avatar unavailable');expect(host.querySelector('.mz-robot-error')).not.toBeNull();});
it('a recovered 3D renderer removes the fallback and its failure state',()=>{mount();act(()=>f.instance!.onFailure('no WebGL'));act(()=>host.querySelector('img')!.dispatchEvent(new Event('load')));act(()=>f.instance!.onReady(true));expect(host.querySelector('[data-robot-renderer="webgl"]')).not.toBeNull();expect(host.querySelector('img')).toBeNull();expect(host.querySelector('[data-robot-error]')).toBeNull();});
