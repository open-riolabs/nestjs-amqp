import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { findConfigYaml, readConfigDoc, setIn, writeConfigDoc } from '../utils/yaml-config.util';
import { HardenGatewayOptions } from './schema';

/**
 * `harden-gateway` — set the gateway growth/DoS limits in config.yaml (only the options you pass)
 * and, when `maxBodyBytes` is provided, patch main.ts to re-register the JSON/urlencoded body
 * parsers with that limit (the framework default is ~100kb). Both halves are idempotent.
 */
export function main(options: HardenGatewayOptions): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const configPath = findConfigYaml(tree, options.config);
    const { doc, existed } = readConfigDoc(tree, configPath);
    if (!existed) context.logger.info(`[rlb-amqp] ${configPath} not found — creating it.`);

    // YAML: set ONLY the limits actually supplied (leave everything else untouched).
    const set = (path: (string | number)[], value: unknown, label: string) => {
      const outcome = setIn(doc, path, value);
      const verb = outcome === 'created' ? 'set' : outcome === 'updated' ? 'updated' : 'unchanged';
      context.logger.info(`[rlb-amqp] ${label}: ${verb}.`);
    };

    if (options.maxConcurrentRequests !== undefined) set(['gateway', 'maxConcurrentRequests'], options.maxConcurrentRequests, 'gateway.maxConcurrentRequests');
    if (options.maxBodyBytes !== undefined) set(['gateway', 'maxBodyBytes'], options.maxBodyBytes, 'gateway.maxBodyBytes');
    if (options.uploadMaxFileSizeMb !== undefined) set(['gateway', 'upload', 'maxFileSizeMb'], options.uploadMaxFileSizeMb, 'gateway.upload.maxFileSizeMb');
    if (options.uploadMaxFiles !== undefined) set(['gateway', 'upload', 'maxFiles'], options.uploadMaxFiles, 'gateway.upload.maxFiles');
    if (options.wsMaxBufferedBytes !== undefined) set(['gateway', 'ws', 'maxBufferedBytes'], options.wsMaxBufferedBytes, 'gateway.ws.maxBufferedBytes');
    if (options.wsMaxMessageBytes !== undefined) set(['gateway', 'ws', 'maxMessageBytes'], options.wsMaxMessageBytes, 'gateway.ws.maxMessageBytes');
    if (options.allowedOrigins !== undefined) set(['gateway', 'ws', 'allowedOrigins'], options.allowedOrigins, 'gateway.ws.allowedOrigins');

    writeConfigDoc(tree, configPath, doc);

    // main.ts body-parser patch — only when a body limit is configured AND patching is enabled.
    const patchMain = options.patchMain ?? true;
    if (options.maxBodyBytes !== undefined && patchMain) {
      patchMainTs(tree, context);
    }

    return tree;
  };
}

/** Re-register the JSON/urlencoded body parsers with gateway.maxBodyBytes. Idempotent + no-op when unfindable. */
function patchMainTs(tree: Tree, context: SchematicContext): void {
  const candidatePaths = ['/src/main.ts', '/app/main.ts', 'src/main.ts', 'app/main.ts'];
  const mainPath = candidatePaths.find((p) => tree.exists(p)) || findFileInTree(tree, 'main.ts');
  if (!mainPath) {
    context.logger.warn('[rlb-amqp] main.ts not found: add the useBodyParser(maxBodyBytes) wiring manually.');
    return;
  }

  let content = tree.read(mainPath)!.toString('utf-8');
  if (content.includes('useBodyParser')) {
    context.logger.info('[rlb-amqp] main.ts already calls useBodyParser — left unchanged.');
    return;
  }

  // Insert the imports the injected block needs (if missing).
  let importAdds = '';
  if (!content.includes('ConfigService')) importAdds += "\nimport { ConfigService } from '@nestjs/config';";
  if (!content.includes('GatewayConfig')) importAdds += "\nimport { GatewayConfig } from '@open-rlb/nestjs-amqp';";
  if (importAdds) {
    const pos = findLastImportEndIndex(content);
    content = content.slice(0, pos) + importAdds + content.slice(pos);
  }

  const m = content.match(
    /const\s+(\w+)\s*=\s*await\s+NestFactory\.create(?:<[^>]*>)?\(\s*[A-Za-z0-9_]+\s*(?:,\s*\{[^}]*\})?\s*\)\s*;?/,
  );
  if (!m) {
    context.logger.warn('[rlb-amqp] NestFactory.create() not found in main.ts: add the useBodyParser wiring manually (YAML changes kept).');
    tree.overwrite(mainPath, content);
    return;
  }

  const app = m[1];
  const block =
    `\n\n  const gateway = ${app}.get(ConfigService).get<GatewayConfig>('gateway');\n` +
    `  if (gateway?.maxBodyBytes) {\n` +
    `    ${app}.useBodyParser('json', { limit: gateway.maxBodyBytes });\n` +
    `    ${app}.useBodyParser('urlencoded', { extended: true, limit: gateway.maxBodyBytes });\n` +
    `  }`;
  const insertAt = m.index! + m[0].length;
  content = content.slice(0, insertAt) + block + content.slice(insertAt);

  tree.overwrite(mainPath, content);
  context.logger.info('[rlb-amqp] main.ts: body-parser limit wiring added.');
}

/** Local copy (do not import from nest-add): first import-statement end offset. */
function findLastImportEndIndex(source: string): number {
  const importRegex = /^import\s+.+from\s+['"][^'"]+['"];?\s*$/gm;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  return lastEnd;
}

/** Local copy (do not import from nest-add): first file whose path ends with `/<fileName>`. */
function findFileInTree(tree: Tree, fileName: string): string | undefined {
  let found: string | undefined;
  tree.visit((path) => {
    if (!found && path.endsWith(`/${fileName}`)) found = path;
  });
  return found;
}
