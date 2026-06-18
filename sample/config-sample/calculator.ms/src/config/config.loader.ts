import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = 'config/config.yaml';

export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;