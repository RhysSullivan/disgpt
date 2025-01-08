import {
	LogLevel,
	SapphireClient,
} from '@sapphire/framework';
import { sharedEnvs } from '@acme/env/env';
import { Partials, VoiceBasedChannel } from 'discord.js';
import type { ClientOptions } from 'discord.js';
import { 
	joinVoiceChannel, 
	VoiceConnectionStatus,
	createAudioPlayer,
	createAudioResource,
	EndBehaviorType,
	VoiceConnection
} from '@discordjs/voice';
import OpenAI from 'openai';
import OpusScript from 'opusscript';
import * as fs from 'fs';
import * as prism from 'prism-media';
const ffmpeg = require('fluent-ffmpeg');

const openai = new OpenAI({
	apiKey: sharedEnvs.OPENAI_API_KEY,
});

// Create an Opus encoder for audio processing
const encoder = new OpusScript(48000, 2);

// Create recordings directory if it doesn't exist
if (!fs.existsSync('./recordings')) {
    fs.mkdirSync('./recordings');
}

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
		// Start recording for all members in the channel
		voiceChannel.members.forEach(member => {
			if (!member.user.bot) {
				handleRecording(member.user.id, connection, voiceChannel);
			}
		});
	});

	// Handle connection errors
	connection.on('error', (error) => {
		console.error('Voice connection error:', error);
	});

	return connection;
}

function handleRecording(userId: string, connection: VoiceConnection, channel: VoiceBasedChannel) {
	const client = channel.client;
    const receiver = connection.receiver;
    client.logger.debug(`Started listening to user ${userId}`);
    
    const filePath = `./recordings/${userId}.pcm`;
    const writeStream = fs.createWriteStream(filePath);
    
    // Add speaking event handlers
    receiver.speaking.on('start', userId => {
        client.logger.debug(`User ${userId} started speaking`);
    });

    receiver.speaking.on('end', userId => {
        client.logger.debug(`User ${userId} stopped speaking`);
    });
    
    const listenStream = receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 1000, // 1 second of silence before ending
        },
    });

    const opusDecoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 1,
        rate: 48000,
    });

    listenStream.pipe(opusDecoder).pipe(writeStream);

    writeStream.on('finish', () => {
        client.logger.debug(`Recording finished for user ${userId}`);
        convertAndTranscribe(filePath, userId, connection, channel);
    });
}

async function convertAndTranscribe(filePath: string, userId: string, connection: VoiceConnection, channel: VoiceBasedChannel) {
    const mp3Path = filePath.replace('.pcm', '.mp3');
    const client = channel.client;
    // Convert PCM to MP3
    ffmpeg(filePath)
        .inputFormat('s16le')
        .audioChannels(1)
        .audioFrequency(48000)
        .format('mp3')
        .on('end', async () => {
            client.logger.debug('Audio conversion finished');
            
            try {
                // Create form data for OpenAI API
                const file = fs.createReadStream(mp3Path);
                const transcript = await openai.audio.transcriptions.create({
                    file,
                    model: "whisper-1",
                });

                client.logger.debug(`Transcription for ${userId}:`);
                client.logger.debug(`"${transcript.text}"`);

                // Clean up files
                fs.unlinkSync(filePath);
                fs.unlinkSync(mp3Path);
                
                // Start listening again
                handleRecording(userId, connection, channel);
            } catch (error) {
                console.error('Transcription error:', error);
                // Clean up files even if transcription fails
                try {
                    fs.unlinkSync(filePath);
                    fs.unlinkSync(mp3Path);
                } catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }
            }
        })
        .on('error', (err: Error) => {
            console.error('Conversion error:', err);
            try {
                fs.unlinkSync(filePath);
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
        })
        .save(mp3Path);
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