export interface WaveEpisode {
    num: number;
    id: string;
    title: string;
}
export interface WaveServer {
    name: string;
    sourceId: string;
    type: 'sub' | 'dub' | 'raw';
}
export declare function searchAniWaves(query: string): Promise<{
    title: string;
    id: string;
    url: string;
}[]>;
export declare function getWaveEpisodes(animeId: string): Promise<WaveEpisode[]>;
export declare function getWaveServers(episodeId: string): Promise<WaveServer[]>;
export declare function getWaveEmbedUrl(sourceId: string): Promise<{
    embedUrl: string;
    serverName: string;
} | null>;
//# sourceMappingURL=aniwaves.d.ts.map