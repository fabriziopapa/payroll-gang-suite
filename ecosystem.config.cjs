// ============================================================
// PAYROLL GANG SUITE — PM2 Ecosystem (aapanel)
// Usa .cjs perché il server è ESM (type: "module")
// In aapanel: Node.js Project Manager → startup file = ecosystem.config.cjs
// ============================================================

module.exports = {
  apps: [
    {
      name:             'payroll-gang-suite',
      script:           './server/dist/app.js',
      cwd:              '/path/to/payroll-gang-suite',       // ← path root su VPS (adattare)
      instances:        1,
      exec_mode:        'fork',           // fork (non cluster) per ESM
      node_args:        '--env-file=.env',
      env_production: {
        NODE_ENV:   'production',
        PORT:       3001,
      },
      // Log
      out_file:         './logs/pm2-out.log',
      error_file:       './logs/pm2-err.log',
      log_date_format:  'YYYY-MM-DD HH:mm:ss',
      merge_logs:       true,
      // Restart policy
      watch:            false,
      max_restarts:     10,
      min_uptime:       '10s',
      restart_delay:    4000,
      // Graceful shutdown (aspetta che Fastify chiuda le connessioni)
      kill_timeout:     5000,
      listen_timeout:   10000,
    },
  ],
}
