export interface DaoEpisode {
    num: number;
    id: string;
    title: string;
}
export interface DaoServer {
    name: string;
    sourceId: string;
    type: 'sub' | 'dub' | 'raw';
}
export declare function searchAniDao(query: string): Promise<{
    title: string;
    id: string;
    url: string;
}[]>;
export declare function getDaoEpisodes(animeId: string): Promise<DaoEpisode[]>;
export declare function getDaoServers(episodeId: string): Promise<DaoServer[]>;
export declare function getDaoEmbedUrl(sourceId: string): Promise<{
    embedUrl: string;
    serverName: string;
} | null>;
//# sourceMappingURL=anidao.d.ts.map