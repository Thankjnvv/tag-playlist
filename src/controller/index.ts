import { Dal } from "../dal/interfaces";
import { MusicService } from "../music-service-management/interfaces";
import { TrackWithTags, User, Track, PlaylistMetadata } from "../interfaces";
import _ from "lodash";

export class Controller {
    constructor(private musicService: MusicService, private dal: Dal) {
    }

    public async syncTracks(user: User) {
        const [musicServiceTracks, dalTracks]: [Track[], TrackWithTags[]] = await Promise.all([
            this.musicService.getAllSongs(user),
            this.dal.getUserTracks(user, this.musicService.type)
        ]);

        return Promise.all([
            this.addRelevantTracksToDal(user, musicServiceTracks, dalTracks),
            this.deleteRelevantTracksFromDal(user, musicServiceTracks, dalTracks)
        ]);
    }

    public async getPlaylists(user: User): Promise<{ playlist: PlaylistMetadata, tracks: TrackWithTags[] }[]> {
        const playlistsMetadata: PlaylistMetadata[] = await this.musicService.getPlaylistsMetadata(user);
        const playlists = await Promise.all(playlistsMetadata.map(async playlist => ({
            playlist,
            tracks: await this.musicService.getPlaylistTracks(user, playlist.id)
        })));

        return this.attachTags(user, playlists);
    }

    public async addTagsToTracks(user: User, tracksIds: string[], tags: string[]): Promise<void> {
        const tracks: TrackWithTags[] = await this.dal.getTracksByIds(user, this.musicService.type, tracksIds);
        const tracksByIds = _.keyBy(tracks, 'id');

        const tracksToUpdate = tracksIds.reduce((result, trackId) => {
            const track = tracksByIds[trackId];
            const tagsToAdd = _.difference(tags, track.tags);
            if (tagsToAdd.length > 0) {
                result.push({
                    ...track,
                    tags: [...track.tags, ...tagsToAdd]
                });
            }

            return result;
        }, []);

        if (tracksToUpdate.length > 0) {
            return this.dal.upsertTracks(user, this.musicService.type, tracksToUpdate);
        }
    }

    public async removeTagsFromTracks(user: User, tracksIds: string[], tags: string[]): Promise<void> {
        const tracks: TrackWithTags[] = await this.dal.getTracksByIds(user, this.musicService.type, tracksIds);
        const tracksByIds = _.keyBy(tracks, 'id');

        const tracksToUpdate = tracksIds.reduce((result, trackId) => {
            const track = tracksByIds[trackId];
            const reducedTags = _.difference(track.tags, tags);
            if (reducedTags.length < track.tags.length) {
                result.push({
                    ...track,
                    tags: reducedTags
                });
            }

            return result;
        }, []);

        if (tracksToUpdate.length > 0) {
            return this.dal.upsertTracks(user, this.musicService.type, tracksToUpdate);
        }
    }

    public async createPlaylistByTags(user: User, playlistName: string, tags: string[]): Promise<string> {
        const playlistId = await this.musicService.createPlaylist(user, playlistName);
        await this.updatePlaylistByTags(user, playlistId, tags);

        return playlistId;
    }

    public async updatePlaylistByTags(user: User, playlistId: string, tags: string[]): Promise<void> {
        const tracksByTags: TrackWithTags[] = (await this.dal.getTracksByTags(user, this.musicService.type, tags));
        const playlistTracks: Track[] = (await this.musicService.getPlaylistTracks(user, playlistId));
        const trackIdsToAdd: string[] = _(tracksByTags)
            .differenceBy(playlistTracks, 'id')
            .map(track => 'id')
            .value();

        return this.musicService.updatePlaylistTracks(user, playlistId, trackIdsToAdd);
    }

    private addRelevantTracksToDal(user: User, musicServiceTracks: Track[], dalTracks: TrackWithTags[]) {
        const tracksToAdd: Track[] = _.differenceBy(musicServiceTracks, dalTracks, 'id');
        const formattedTracksToAdd: TrackWithTags[] = tracksToAdd.map(track => ({
            ...track,
            tags: []
        }));
        return formattedTracksToAdd.length > 0
            ? this.dal.upsertTracks(user, this.musicService.type, formattedTracksToAdd)
            : Promise.resolve();
    }

    private deleteRelevantTracksFromDal(user: User, musicServiceTracks: Track[], dalTracks: TrackWithTags[]) {
        const trackIdsToDelete: string[] = _(dalTracks)
            .differenceBy(musicServiceTracks, 'id')
            .map('id')
            .value();

        return trackIdsToDelete.length > 0
            ? this.dal.deleteTracks(user, this.musicService.type, trackIdsToDelete)
            : Promise.resolve();
    }

    private async attachTags(user: User, playlists: { playlist: PlaylistMetadata, tracks: Track[] }[]) {
        const allTracksIds = _.flatMap(playlists, playlist => playlist.tracks.map(track => track.id));
        const tracksFromDal: TrackWithTags[] = await this.dal.getTracksByIds(user, this.musicService.type, allTracksIds);
        const tracksByIds = _.keyBy(tracksFromDal, 'id');

        return playlists.map(playlistData => ({
            playlist: playlistData.playlist,
            tracks: playlistData.tracks.map(track => {
                return tracksByIds[track.id]
                    ? tracksByIds[track.id]
                    : { ...track, tags: [] }
            })
        }));        
    }
}