#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { init, startInstance, stopInstance, getActiveInstance, execPhp, formatUptime } from '../src/lib/instance-manager.js';
import { validateBlueprint, enhanceBlueprint } from '../src/lib/blueprint-validator.js';
import { wpCliToPhp } from '../src/lib/wp-cli-mapper.js';
import { readLogs } from '../src/lib/logger.js';
import { getBlueprintReference } from '../src/lib/blueprint-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('wp-playground')
  .description('CLI for managing ephemeral WordPress Playground instances')
  .version(pkg.version);

// ─── start ──────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start a WordPress Playground instance')
  .option('--blueprint <path>', 'Path to a Blueprint JSON file')
  .option('--port <number>', 'Port to run on (default: 9400)', parseInt)
  .option('--php <version>', 'PHP version (e.g. 8.3, 8.2, 7.4)')
  .option('--wp <version>', 'WordPress version (e.g. latest, 6.7)')
  .option('--plugin <slugs...>', 'Plugin slugs to install from wordpress.org')
  .option('--mount <mappings...>', 'Mount local directories (format: /host:/vfs)')
  .option('--mount-before-install <mappings...>', 'Mount before WordPress install')
  .action(async (opts) => {
    try {
      init();

      let blueprint = {};

      // Load blueprint from file if provided
      if (opts.blueprint) {
        const bpPath = resolve(opts.blueprint);
        if (!existsSync(bpPath)) {
          console.error(`Error: Blueprint file not found: ${bpPath}`);
          process.exit(1);
        }
        try {
          blueprint = JSON.parse(readFileSync(bpPath, 'utf-8'));
        } catch (err) {
          console.error(`Error: Invalid JSON in blueprint file: ${err.message}`);
          process.exit(1);
        }
      }

      // Apply CLI option shortcuts
      if (opts.php || opts.wp) {
        if (!blueprint.preferredVersions) blueprint.preferredVersions = {};
        if (opts.php) blueprint.preferredVersions.php = opts.php;
        if (opts.wp) blueprint.preferredVersions.wp = opts.wp;
      }

      if (opts.plugin) {
        if (!blueprint.plugins) blueprint.plugins = [];
        blueprint.plugins.push(...opts.plugin);
      }

      // Validate
      const validation = validateBlueprint(blueprint);
      if (!validation.valid) {
        console.error('Blueprint validation failed:');
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      // Enhance
      const enhancements = enhanceBlueprint(blueprint);

      console.log('Starting WordPress Playground...');
      if (enhancements.length > 0) {
        console.log('Auto-enhancements:');
        for (const e of enhancements) {
          console.log(`  + ${e}`);
        }
      }

      const result = await startInstance({
        blueprint,
        port: opts.port,
        mount: opts.mount,
        mountBeforeInstall: opts.mountBeforeInstall,
        enhancements,
      });

      console.log('');
      console.log(`Playground is running!`);
      console.log(`  URL:         ${result.url}`);
      console.log(`  Instance:    ${result.instanceId}`);
      console.log(`  Port:        ${result.port}`);
      console.log(`  Credentials: admin / password`);
      console.log('');
      console.log('Press Ctrl+C to stop.');

      // Keep the process running
      await new Promise(() => {});
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── stop ───────────────────────────────────────────────────────────
program
  .command('stop')
  .description('Stop the active Playground instance')
  .action(async () => {
    try {
      init();
      const result = await stopInstance();
      console.log(`Stopped instance ${result.instanceId} (uptime: ${result.uptime})`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── status ─────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show the status of the active Playground instance')
  .action(() => {
    try {
      init();
      const info = getActiveInstance();
      if (!info) {
        console.log('No Playground instance is running.');
        return;
      }

      const uptime = formatUptime(info.startedAt);
      console.log('Playground Instance:');
      console.log(`  Status:      running`);
      console.log(`  Instance ID: ${info.instanceId}`);
      console.log(`  URL:         ${info.url}`);
      console.log(`  Port:        ${info.port}`);
      console.log(`  Uptime:      ${uptime}`);
      if (info.pid) console.log(`  PID:         ${info.pid}`);
      if (info.blueprint?.preferredVersions?.php) {
        console.log(`  PHP:         ${info.blueprint.preferredVersions.php}`);
      }
      if (info.blueprint?.plugins?.length > 0) {
        console.log(`  Plugins:     ${info.blueprint.plugins.join(', ')}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── wp ─────────────────────────────────────────────────────────────
program
  .command('wp <command...>')
  .description('Run a WP-CLI command against the active Playground instance')
  .action(async (commandParts) => {
    try {
      init();

      const command = commandParts.join(' ');
      const { php, error: mapError } = wpCliToPhp(command);

      if (mapError && !php) {
        console.error(`Error: ${mapError}`);
        process.exit(1);
      }

      if (php === null) {
        console.error('This command cannot be translated to PHP. Include it as a wp-cli blueprint step instead.');
        process.exit(1);
      }

      const result = await execPhp(php);

      if (result.output) console.log(result.output);
      if (result.error) console.error(`Error: ${result.error}`);
      if (result.exitCode !== 0) process.exit(result.exitCode);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── logs ───────────────────────────────────────────────────────────
program
  .command('logs')
  .description('View Playground logs')
  .option('--lines <number>', 'Number of lines to show (default: 50)', parseInt)
  .option('--type <type>', 'Filter: all, error, php (default: all)')
  .action((opts) => {
    try {
      const logs = readLogs({
        lines: opts.lines || 50,
        type: opts.type || 'all',
      });
      console.log(logs);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── schema ─────────────────────────────────────────────────────────
program
  .command('schema')
  .description('Print the Blueprint schema reference')
  .action(() => {
    try {
      const ref = getBlueprintReference();
      console.log(JSON.stringify(ref, null, 2));
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
