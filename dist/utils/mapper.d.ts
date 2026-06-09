export interface SiteIds {
    anilistId: number;
    malId: number | null;
    title: string;
    siteIds: {
        zoro?: string;
        gogoanime?: string;
        animepahe?: string;
        anidao?: string;
    };
}
export declare function malToAnilist(malId: number): Promise<number | null>;
export declare function getSiteIds(anilistId: number): Promise<SiteIds | null>;
export declare function searchAnilist(query: string): Promise<{
    id: number;
    malId: number | null;
    title: string;
    coverImage: string;
    episodes: number | null;
    status: string;
    format: string;
}[]>;
//# sourceMappingURL=mapper.d.ts.map