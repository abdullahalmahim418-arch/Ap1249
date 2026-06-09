export interface PaheEpisode {
    num: number;
    session: string;
    snapshot: string;
    duration: string;
    created: string;
}
export declare function searchAnimePahe(query: string): Promise<{
    id: string;
    title: string;
    session: string;
}[]>;
export declare function getPaheEpisodes(session: string, page?: number): Promise<PaheEpisode[]>;
export declare function getPaheEmbeds(animeSession: string, episodeSession: string): Promise<{
    quality: string;
    url: string;
    audio: string;
}[]>;
//# sourceMappingURL=animepahe.d.ts.map