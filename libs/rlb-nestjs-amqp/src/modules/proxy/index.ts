export * from './config/path-definition.config';
export * from './proxy.module';
export * from './services/acl.service';
export * from './services/auth-provider-registry.service';
export * from './services/metrics-hook';

export interface ProcessedAuthData {
    [key: string]: any;
    success: boolean;
}