export * from './config/path-definition.config';
export * from './proxy.module';
export * from './services/acl.service';

export interface ProcessedAuthData {
    [key: string]: any;
    success: boolean;
}