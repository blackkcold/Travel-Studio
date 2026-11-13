import type { Server } from 'node:http';
export interface AIConfiguration { key: string; baseURL: string; model: string; visionModel: string; providerId: string }
export function configFromEnvironment(environment?: Record<string, string | undefined>): AIConfiguration;
export function createTravelServer(options?: { directory?: string; ai?: Partial<AIConfiguration>; fetchImpl?: typeof fetch }): Server;
