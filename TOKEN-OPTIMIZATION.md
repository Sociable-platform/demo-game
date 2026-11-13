# Player token optimization

Browser token caching and single-flight coordination are implemented in
frontend/src/community/playerToken.js and exposed by api.js getClanPlayerToken.
Tokens stay in memory, use backend expiresIn/expiresAt metadata, and refresh on
use within30seconds (or10% lifetime for short TTLs) of expiry. Forced refresh
bypasses browser cache and requests {forceRefresh:true} from /api/clan/token.
The server bridge has no token cache: every call exchanges directly with Platform,
with no-store fetching. Only the backend has the game API key.

Auth changes clear cache/in-flight references at both boundaries; acquisition is
blocked during login/logout. Session expiry also clears it. The mount adapter
destroys its widget before resetting the SDK, so no old-session completion or
ready/join event can affect a replacement player.

Local .env.local uses the existing CLAN_SDK_ENTRY override to select the updated
SDK at C:/Users/Nicat/Desktop/clan-sdk/clan-sdk/src/index.js instead of the older
vendored snapshot. Restart Vite after changing this setting. Configure the path
for each machine/deployment; it is not a portable package release. API keys were
not moved into frontend settings.

Results: SDK230 tests, game backend53 tests, game frontend25 tests all passed.
Backend TypeScript and frontend Vite production builds passed. Friends reads are
all retained; parallel getMyPlayer/listFriends/listFriendRequests share normal
acquisition and a single forced refresh after concurrent401s. Every HTTP request
has at most one retry. Verification used mocks/builds, not a live auth workflow.
