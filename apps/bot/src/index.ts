import {
	LogLevel,
	SapphireClient,
} from '@sapphire/framework';
import { sharedEnvs } from '@acme/env/env';
import { Partials } from 'discord.js';
import type { ClientOptions } from 'discord.js';
import { 
	joinVoiceChannel,
	createAudioPlayer,
	createAudioResource,
	StreamType,
	VoiceConnection,
	AudioPlayer,
	EndBehaviorType,
} from '@discordjs/voice';
import WebSocket from 'ws';
import { Readable } from 'stream';
import OpusScript from 'opusscript';
import prism from 'prism-media';
import axios from 'axios';

// Types for OpenAI Realtime API
interface OpenAISession {
	id: string;
	object: string;
	model: string;
	modalities: string[];
	instructions?: string;
	voice: string;
	input_audio_format: string;
	output_audio_format: string;
	input_audio_transcription: null | { model: string };
	turn_detection: null | {
		type: string;
		threshold: number;
		prefix_padding_ms: number;
		silence_duration_ms: number;
	};
	tools: any[];
	tool_choice: string;
	temperature: number;
	max_response_output_tokens: number | string;
	client_secret?: {
		value: string;
		expires_at: number;
	};
}

// Types for WebSocket messages
interface OpenAIMessage {
	type: string;
	session?: {
		id: string;
	};
	delta?: string;
	error?: {
		message: string;
		type: string;
		code: string;
	};
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

const test = {
	guild: '1037547185492996207',
	voiceChannel: '1037547185492996211'
};

const zoomer = {
	guild: '1315920303507111956',
	voiceChannel: '1315920303989329953'
}

const ids = zoomer;

async function createRealtimeSession(): Promise<OpenAISession> {
	try {
		const response = await axios.post(
			'https://api.openai.com/v1/realtime/sessions',
			{
				model: "gpt-4o-realtime-preview-2024-12-17",
				modalities: ["audio", "text"],
				instructions: "You are a helpful AI assistant. Keep your responses concise and natural.",
				voice: "alloy",
				input_audio_format: "pcm16",
				output_audio_format: "pcm16",
				input_audio_transcription: {
					model: "whisper-1"
				},
				turn_detection: {
					type: "server_vad",
					threshold: 0.5,
					prefix_padding_ms: 300,
					silence_duration_ms: 500,
					create_response: true
				}
			},
			{
				headers: {
					'Authorization': `Bearer ${sharedEnvs.OPENAI_API_KEY}`,
					'Content-Type': 'application/json'
				}
			}
		);
		return response.data;
	} catch (error) {
		console.error('Failed to create realtime session:', error);
		throw error;
	}
}

async function setupVoiceConnection(client: SapphireClient) {
	const guild = await client.guilds.fetch(ids.guild);
	if (!guild) {
		client.logger.error('No guild found');
		return;
	}

	const voiceChannel = await guild.channels.fetch(ids.voiceChannel);
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

	const player = createAudioPlayer();
	connection.subscribe(player);

	try {
		// Create a realtime session first
		const session = await createRealtimeSession();
		client.logger.info('Created realtime session:', session.id);

		// Set up WebSocket connection using the session token
		const ws = new WebSocket(`wss://api.openai.com/v1/realtime`, {
			headers: {
				'Authorization': `Bearer ${session.client_secret?.value}`,
				'OpenAI-Beta': 'realtime=v1'
			}
		});

		ws.on('open', () => {
			client.logger.info('Connected to OpenAI Realtime API');
			setupVoiceProcessing(connection, ws, player, client);
		});

		ws.on('error', (error) => {
			client.logger.error('WebSocket error:', error);
		});

		return connection;
	} catch (error) {
		client.logger.error('Failed to setup voice connection:', error);
		throw error;
	}
}

function setupVoiceProcessing(connection: VoiceConnection, ws: WebSocket, player: AudioPlayer, client: SapphireClient) {
	client.logger.info('Voice processing initialized');

	// Buffer to accumulate audio data
	let audioBuffer: Buffer[] = [];
	let isProcessingAudio = false;
	const MIN_BUFFER_SIZE = 4800; // 100ms at 48kHz

	// Add player state logging
	player.on('stateChange', (oldState, newState) => {
		client.logger.debug(`Audio player state changed from ${oldState.status} to ${newState.status}`);
		
		if (newState.status === 'idle' && oldState.status !== 'playing') {
			client.logger.debug('Audio player entered idle state unexpectedly, attempting to recover...');
		}
	});

	player.on('error', error => {
		client.logger.error('Audio player error:', error);
		try {
			player.stop();
		} catch (e) {
			client.logger.error('Failed to stop player after error:', e);
		}
	});

	connection.on('stateChange', (oldState, newState) => {
		client.logger.debug(`Voice connection state changed from ${oldState.status} to ${newState.status}`);
		
		if (newState.status === 'disconnected') {
			client.logger.warn('Voice connection disconnected, attempting to reconnect...');
			try {
				connection.rejoin();
			} catch (e) {
				client.logger.error('Failed to rejoin voice channel:', e);
			}
		}
	});

	// Handle WebSocket messages
	ws.on('message', (rawData) => {
		try {
			const message = JSON.parse(rawData.toString()) as OpenAIMessage;
			client.logger.debug('Received message type:', message.type);

			switch (message.type) {
				case 'session.created':
					client.logger.info('Session created:', message.session?.id);
					break;

				case 'response.audio.delta':
					if (message.delta) {
						try {
							// Decode base64 audio data to PCM
							const pcmData = Buffer.from(message.delta, 'base64');
							
							// Create a readable stream from the PCM data
							const pcmStream = new Readable({
								read() {
									this.push(pcmData);
									this.push(null);
								}
							});

							// Create an Opus encoder stream
							const opusEncoder = new prism.opus.Encoder({
								rate: 48000,
								channels: 1,
								frameSize: 960
							});

							// Create a resource from the Opus stream
							const resource = createAudioResource(pcmStream.pipe(opusEncoder), {
								inputType: StreamType.Opus,
								inlineVolume: true
							});

							if (resource.volume) {
								resource.volume.setVolume(1.5);
							}

							player.play(resource);
						} catch (error) {
							client.logger.error('Error processing audio delta:', error);
						}
					}
					break;

				case 'error':
					client.logger.error('OpenAI Error:', message.error);
					break;
			}
		} catch (error) {
			client.logger.error('Error processing message:', error);
		}
	});

	// Handle voice input
	connection.receiver.speaking.on('start', async (userId) => {
		if (userId !== '523949187663134754') return;

		const user = await client.users.fetch(userId);
		client.logger.info(`User ${user.username} started speaking`);
		audioBuffer = [];
		isProcessingAudio = true;

		const audioStream = connection.receiver.subscribe(userId, {
			end: {
				behavior: EndBehaviorType.Manual,
			},
		});

		const opusDecoder = new prism.opus.Decoder({
			rate: 48000,
			channels: 1,
			frameSize: 960
		});

		audioStream
			.pipe(opusDecoder)
			.on('data', (chunk: Buffer) => {
				if (!isProcessingAudio) return;
				
				// Accumulate audio data
				audioBuffer.push(chunk);
				
				// Only send if we have enough data
				if (Buffer.concat(audioBuffer).length >= MIN_BUFFER_SIZE) {
					const audioData = Buffer.concat(audioBuffer);
					ws.send(JSON.stringify({
						type: 'input_audio_buffer.append',
						audio: audioData.toString('base64')
					}));
					audioBuffer = [];
				}
			})
			.on('error', (error) => {
				client.logger.error('Audio processing error:', error);
			});
	});

	connection.receiver.speaking.on('end', async (userId) => {
		if (userId !== '523949187663134754') return;

		const user = await client.users.fetch(userId);
		client.logger.info(`User ${user.username} stopped speaking`);
		
		// Send any remaining buffered audio
		if (audioBuffer.length > 0) {
			const audioData = Buffer.concat(audioBuffer);
			if (audioData.length >= MIN_BUFFER_SIZE) {
				ws.send(JSON.stringify({
					type: 'input_audio_buffer.append',
					audio: audioData.toString('base64')
				}));
			}
		}
		
		isProcessingAudio = false;
		audioBuffer = [];

		// Commit the audio buffer
		ws.send(JSON.stringify({
			type: 'input_audio_buffer.commit'
		}));
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