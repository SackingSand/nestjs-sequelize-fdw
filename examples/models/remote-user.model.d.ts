import { FDWModel } from '../../src';
export declare class RemoteUser extends FDWModel<RemoteUser> {
    id: string;
    email: string;
    status: 'active' | 'inactive';
}
