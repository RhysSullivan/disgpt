/* eslint-disable n/no-process-env */
process.env = {
	...process.env,
	NODE_ENV: process.env.NODE_ENV ?? 'development',
	NEXT_PUBLIC_DEPLOYMENT_ENV: process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? 'local',
};

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const envNumber = z
	.string()
	.transform((s) => parseInt(s, 10))
	.pipe(z.number());

export const zStringRequiredInProduction = z
	.string()
	.optional()
	.refine(
		(token) => {
			if (
				process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === 'local' ||
				process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === 'ci' ||
				process.env.NODE_ENV === 'development' ||
				process.env.NODE_ENV === 'test'
			) {
				return true;
			}
			return token ? token.length > 0 : false;
		},
		{ message: 'Required in production' },
	);

export const zNumberRequiredInProduction = z
	.string()
	.optional()
	.refine(
		(token) => {
			if (
				process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === 'local' ||
				process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === 'ci' ||
				process.env.NODE_ENV === 'development' ||
				process.env.NODE_ENV === 'test'
			) {
				return true;
			}
			return token ? token.length > 0 : false;
		},
		{ message: 'Required in production' },
	)
	.transform((s) => {
		if (s) {
			return parseInt(s, 10);
		}
		return undefined;
	})
	.pipe(z.number().optional());

export const nodeEnv = z
	.string()
	.optional()
	.default('development')
	.pipe(z.enum(['development', 'production', 'test']));

export function zStringDefaultInDev(defaultValue: string) {
	const isDev =
		process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === 'local' ||
		process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === 'ci' ||
		process.env.NODE_ENV === 'development' ||
		process.env.NODE_ENV === 'test';
	if (!isDev) {
		return z.string();
	}
	return z.string().optional().default(defaultValue);
}


export const sharedEnvs = createEnv({
	server: {
		NODE_ENV: nodeEnv,
		DATABASE_URL: zStringDefaultInDev(
			'http://root:nonNullPassword@localhost:3900',
		),
		/*
      Analytics	
     */
		POSTHOG_PROJECT_ID: zNumberRequiredInProduction,
		POSTHOG_PERSONAL_API_KEY: zStringRequiredInProduction,
		AXIOM_API_KEY: zStringRequiredInProduction,
		DISCORD_TOKEN: zStringRequiredInProduction,
	},
	experimental__runtimeEnv: {
	},
	skipValidation: process.env.SKIP_ENV_CHECK === 'true',
});
