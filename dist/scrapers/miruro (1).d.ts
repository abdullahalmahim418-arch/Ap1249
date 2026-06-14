export interface MiruroEpisode {
    num: number;
    id: string;
    title: string;
}
export interface MiruroServer {
    name: string;
    sourceId: string;
    type: 'sub' | 'dub' | 'raw';
}
export interface MiruroEmbedResult {
    embedUrl: string;
    serverName: string;
    type: string;
}
export declare function getMiruroEpisodes(anilistId: number): Promise<MiruroEpisode[]>;
export declare function getMiruroServers(episodeId: string): Promise<MiruroServer[]>;
export declare function getMiruroEmbedUrl(sourceId: string): Promise<MiruroEmbedResult | null>;
//# sourceMappingURL=miruro%20(1).d.ts.map