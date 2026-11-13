import {expect,it,vi} from 'vitest';
import {createPlayerTokenCache} from './playerToken.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
it('reuses tokens, refreshes before expiry, and shares concurrent acquisitions',async()=>{
 let now=1000,n=0;const load=vi.fn(async()=>({token:'token-'+(++n),expiresIn:100,expiresAt:now+100000}));const cache=createPlayerTokenCache(load,()=>now);
 expect(await Promise.all([cache.get(),cache.get(),cache.get()])).toEqual(['token-1','token-1','token-1']);expect(load).toHaveBeenCalledTimes(1);now+=89000;expect(await cache.get()).toBe('token-1');now+=1001;expect(await cache.get()).toBe('token-2');expect(load).toHaveBeenCalledTimes(2);
});
it('forced refresh bypasses a valid token and shares its in-flight request',async()=>{
 const refresh=deferred();const load=vi.fn().mockResolvedValueOnce({token:'old',expiresIn:3600}).mockImplementationOnce(()=>refresh.promise);const cache=createPlayerTokenCache(load);
 await cache.get();const a=cache.get({forceRefresh:true}),b=cache.get({forceRefresh:true}),c=cache.get();refresh.resolve({token:'fresh',expiresIn:3600});expect(await Promise.all([a,b,c])).toEqual(['fresh','fresh','fresh']);expect(load.mock.calls[1][0]).toEqual({forceRefresh:true});expect(load).toHaveBeenCalledTimes(2);
});
it('forced refresh supersedes late normal acquisition without restoring stale tokens',async()=>{
 const normal=deferred();const load=vi.fn().mockImplementationOnce(()=>normal.promise).mockResolvedValueOnce({token:'fresh',expiresIn:3600});const cache=createPlayerTokenCache(load);const old=cache.get();await Promise.resolve();expect(await cache.get({forceRefresh:true})).toBe('fresh');normal.resolve({token:'old',expiresIn:3600});expect(await old).toBe('fresh');expect(await cache.get()).toBe('fresh');
});
it('logout/account switch clears pending references and rejects late prior-session tokens',async()=>{
 const pending=deferred();const load=vi.fn().mockImplementationOnce(()=>pending.promise).mockResolvedValue({token:'new-player',expiresIn:3600});const cache=createPlayerTokenCache(load);const old=expect(cache.get()).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();cache.clear();expect(await cache.get()).toBe('new-player');pending.resolve({token:'old-player',expiresIn:3600});await old;expect(await cache.get()).toBe('new-player');
});
it('errors are not cached and expired responses are not used',async()=>{
 const load=vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({token:'expired',expiresAt:1}).mockResolvedValue({token:'valid',expiresIn:3600});const cache=createPlayerTokenCache(load,()=>1000);await expect(cache.get()).rejects.toThrow('Offline');await expect(cache.get()).rejects.toThrow('expired');expect(await cache.get()).toBe('valid');
});
it('legacy responses without expiry remain usable but are never cached',async()=>{
 const load=vi.fn(async()=>({token:'legacy'}));const cache=createPlayerTokenCache(load);await cache.get();await cache.get();expect(load).toHaveBeenCalledTimes(2);
});

it('a cached-token read cannot escape an account switch before its await resumes',async()=>{
 const cache=createPlayerTokenCache(async()=>({token:'old-player',expiresIn:3600}));await cache.get();const pending=expect(cache.get()).rejects.toMatchObject({name:'AbortError'});cache.clear();await pending;
});
