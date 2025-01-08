import {
	LogLevel,
	SapphireClient,
} from '@sapphire/framework';
import { sharedEnvs } from '@acme/env/env';
import { Partials } from 'discord.js';
import type { ClientOptions } from 'discord.js';
import { 
	joinVoiceChannel, 
	VoiceConnectionStatus,
} from '@discordjs/voice';
import OpenAI from 'openai';
import { OpusEncoder } from '@discordjs/opus';

const openai = new OpenAI({
	apiKey: sharedEnvs.OPENAI_API_KEY,
});

// Create an Opus encoder for audio processing
const encoder = new OpusEncoder(48000, 2);

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

const guildId = '1037547185492996207';
const voiceChannelId = '1037547185492996211';

async function setupVoiceConnection(client: SapphireClient) {
	const guild = await client.guilds.fetch(guildId);
	if (!guild) {
		client.logger.error('No guild found');
		return;
	}

	const voiceChannel = await guild.channels.fetch(voiceChannelId);
	if (!voiceChannel?.isVoiceBased()) {
		client.logger.error('Voice channel not found or is not a voice channel');
		return;
	}

	client.logger.debug(`Attempting to join voice channel: ${voiceChannel.name} (${voiceChannel.id})`);
	const connection = joinVoiceChannel({
		channelId: voiceChannel.id,
		guildId: guild.id,
		adapterCreator: guild.voiceAdapterCreator,
		selfDeaf: false,
	});

	// Handle connection ready state
	connection.on(VoiceConnectionStatus.Ready, () => {
		console.log('Voice connection is ready!');
	});

	// Handle connection errors
	connection.on('error', (error) => {
		console.error('Voice connection error:', error);
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

		// Set up voice connection after successful login
		await setupVoiceConnection(client);
	} catch (error) {
		client.logger.error(error);
	}
};

login(createClient());