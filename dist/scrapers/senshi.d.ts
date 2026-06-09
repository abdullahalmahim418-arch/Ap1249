export interface SenshiEpisode {
    num: number;
    id: string;
    title: string;
}
export interface SenshiServer {
    name: string;
    serverId: string;
    sourceId: string;
    type: 'sub' | 'dub' | 'raw';
}
export interface EmbedResult {
    embedUrl: string;
    serverName: string;
    type: string;
}
export declare function searchSenshi(query: string): Promise<{
    title: string;
    id: string;
    url: string;
}[]>;
export declare function getEpisodes(animeId: string): Promise<SenshiEpisode[]>;
export declare function getServers(episodeId: string): Promise<SenshiServer[]>;
export declare function getEmbedUrl(sourceId: string): Promise<EmbedResult | null>;
//# sourceMappingURL=senshi.d.ts.map