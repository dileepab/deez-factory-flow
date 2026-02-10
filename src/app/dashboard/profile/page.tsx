'use client';

import { ProfileForm } from "@/components/dashboard/profile-form";
import { Separator } from "@/components/ui/separator";

export default function ProfilePage() {
    return (
        <div className="space-y-6 p-10 pb-16 md:block">
            <div className="space-y-0.5">
                <h2 className="text-2xl font-bold tracking-tight">Profile</h2>
                <p className="text-muted-foreground">
                    Manage your account settings and set your e-mail preferences.
                </p>
            </div>
            <Separator className="my-6" />
            <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
                <div className="flex-1 lg:max-w-2xl">
                    <ProfileForm />
                </div>
            </div>
        </div>
    );
}
