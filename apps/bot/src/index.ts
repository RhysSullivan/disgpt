import {
	Events,
	LogLevel,
	SapphireClient,
	container,
} from '@sapphire/framework';
import '../utils/setup';
import { sharedEnvs } from '@acme/env/src/env';
import { Partials } from 'discord.js';
import type { ClientOptions } from 'discord.js';
export function createClient(override: Partial<ClientOptions> = {}) {
	return new SapphireClient({
		logger: {
			level: LogLevel.Debug,
		},
		shards: 'auto',
		intents: [
			'Guilds',
			'GuildMembers',
			'GuildBans',
			'GuildEmojisAndStickers',
			'GuildVoiceStates',
			'GuildMessages',
			'GuildMessageReactions',
			'DirectMessages',
			'DirectMessageReactions',
			'MessageContent',
		],
		partials: [
			Partials.Channel,
			Partials.Message,
			Partials.GuildMember,
			Partials.Reaction,
			Partials.User,
		],
		...override,
	});
}

export const login = async (client: SapphireClient) => {
	require('dotenv').config();
	try {
		client.logger.info('LOGGING IN');
		client.logger.info(`NODE_ENV: ${sharedEnvs.NODE_ENV}`);

		await client.login(sharedEnvs.DISCORD_TOKEN);
		client.logger.info('LOGGED IN');
		client.logger.info(
			`LOGGED IN AS: ${client.user?.displayName ?? 'UNKNOWN'}`,
		);
	} catch (error) {
		client.logger.error(error);
		// await client.destroy();
		// throw error;
	}
};