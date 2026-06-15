/** CLI for vault maintenance: `tsx src/db/cli.ts <backup|check|seed>` */
import { loadConfig } from '../config.js';
import { openDb } from './connection.js';
import { backup, integrityCheck } from './maintenance.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { seedDemoWorld } from '../demo/seed-demo.js';

const command = process.argv[2];
const config = loadConfig();
const db = openDb(config.dataDir);
migrate(db);

switch (command) {
  case 'backup': {
    const dest = await backup(db, config.dataDir);
    console.log(`backup written: ${dest}`);
    break;
  }
  case 'check': {
    const issues = integrityCheck(db);
    if (issues.length === 0) {
      console.log('integrity: ok');
    } else {
      console.error(`integrity issues:\n${issues.join('\n')}`);
      process.exit(1);
    }
    break;
  }
  case 'seed': {
    const result = seed(db);
    console.log(result.seeded ? 'seeded demo vault' : 'vault not empty — skipped');
    break;
  }
  case 'seed:demo': {
    const result = seedDemoWorld(db);
    if (result.seeded) {
      console.log(
        `seeded demo world: ${result.notes} notes, ${result.notebooks} notebooks, ` +
          `${result.savedQueries} saved queries, story ${result.story}`,
      );
    } else {
      console.log('vault not empty — demo world skipped');
    }
    break;
  }
  default:
    console.error('usage: db:cli <backup|check|seed|seed:demo>');
    process.exit(1);
}
db.close();
