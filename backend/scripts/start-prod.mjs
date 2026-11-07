// Cross-platform production launcher (works in PowerShell, cmd, bash): sets NODE_ENV, then starts the compiled server.
process.env.NODE_ENV = 'production';
await import('../dist/index.js');
