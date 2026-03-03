import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

import loadConfig from './config.loader'; // Adjust the path according to your file structure

jest.mock('fs');

describe('loadConfig', () => {
  const YAML_CONFIG_FILENAME = 'config/config.yaml';
  const mockConfig = {
    database: {
      host: 'localhost',
      port: 3306,
    },
    app: {
      port: 8080,
    },
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should load and parse the YAML config file correctly', () => {
    (readFileSync as jest.Mock).mockReturnValue(yaml.dump(mockConfig));

    const config = loadConfig();

    expect(readFileSync).toHaveBeenCalledWith(
      join(process.cwd(), YAML_CONFIG_FILENAME),
      'utf8'
    );
    expect(config).toEqual(mockConfig);
  });

  it('should throw an error if the YAML file does not exist', () => {
    (readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => loadConfig()).toThrow('ENOENT: no such file or directory');
  });

  it('should throw an error if the YAML content is invalid', () => {
    const invalidYAMLContent = `
      database:
        host: localhost
       port: 80`;

    (readFileSync as jest.Mock).mockReturnValue(invalidYAMLContent);

    expect(() => loadConfig()).toThrow()
  });
});
