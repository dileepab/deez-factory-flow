"use client";

import { useAuth } from "@/auth-provider";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfile } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { firestore } from "@/firebase/client";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Check } from "lucide-react";
import { useState } from "react";
import { useDoc } from "@/firebase/firestore/use-doc";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import { cn } from "@/lib/utils";

const profileFormSchema = z.object({
    name: z
        .string()
        .min(2, {
            message: "Name must be at least 2 characters.",
        })
        .max(30, {
            message: "Name must not be longer than 30 characters.",
        }),
    email: z
        .string()
        .email({
            message: "Please enter a valid email address.",
        }),
    avatarUrl: z.string().url({ message: "Please enter a valid URL." }).optional().or(z.literal("")),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const AVATAR_SEEDS = [
    "Felix", "Aneka", "Zoe", "Jack", "Max", "Leo",
    "Bella", "Charlie", "Luna", "Oliver", "Sophie", "Ethan"
];

const PREDEFINED_AVATARS = AVATAR_SEEDS.map(
    (seed) => `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}`
);

export function ProfileForm() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isUpdating, setIsUpdating] = useState(false);

    // Fetch extra user data (like avatarUrl if stored in Firestore)
    const userDocRef = useMemoFirebase(
        () => (user ? doc(firestore, 'users', user.uid) : null),
        [user]
    );
    const { data: userData, isLoading: isDataLoading } = useDoc<any>(userDocRef);


    const form = useForm<ProfileFormValues>({
        resolver: zodResolver(profileFormSchema),
        defaultValues: {
            name: user?.displayName || "",
            email: user?.email || "",
            avatarUrl: userData?.avatarUrl || user?.photoURL || "",
        },
        values: { // Update form when data loads
            name: user?.displayName || "",
            email: user?.email || "",
            avatarUrl: userData?.avatarUrl || user?.photoURL || "",
        }
    });

    async function onSubmit(data: ProfileFormValues) {
        if (!user) return;
        setIsUpdating(true);

        try {
            // 1. Update Firebase Auth Profile
            await updateProfile(user, {
                displayName: data.name,
                photoURL: data.avatarUrl,
            });

            // 2. Update Firestore User Document
            const userRef = doc(firestore, "users", user.uid);
            await updateDoc(userRef, {
                name: data.name,
                avatarUrl: data.avatarUrl,
                // We don't verify email changes here for simplicity, kept read-only logic effectively
            });

            toast({
                title: "Profile updated",
                description: "Your profile information has been updated successfully.",
            });
        } catch (error) {
            console.error("Error updating profile:", error);
            toast({
                title: "Error",
                description: "Failed to update profile. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsUpdating(false);
        }
    }

    if (isDataLoading) {
        return <div>Loading profile data...</div>;
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Display Name</FormLabel>
                            <FormControl>
                                <Input placeholder="Your Name" {...field} />
                            </FormControl>
                            <FormDescription>
                                This is your public display name.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input placeholder="email@example.com" {...field} disabled />
                            </FormControl>
                            <FormDescription>
                                Your email address cannot be changed here.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="avatarUrl"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Avatar</FormLabel>
                            <FormControl>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-4">
                                        {PREDEFINED_AVATARS.map((url) => (
                                            <div
                                                key={url}
                                                className={cn(
                                                    "relative cursor-pointer rounded-full overflow-hidden border-2 transition-all hover:scale-105 aspect-square",
                                                    field.value === url
                                                        ? "border-primary ring-2 ring-primary ring-offset-2"
                                                        : "border-transparent hover:border-muted-foreground/25"
                                                )}
                                                onClick={() => field.onChange(url)}
                                            >
                                                <img
                                                    src={url}
                                                    alt="Avatar option"
                                                    className="h-full w-full object-cover"
                                                />
                                                {field.value === url && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                        <Check className="w-6 h-6 text-white drop-shadow-md" />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-muted-foreground">Or enter a custom URL:</span>
                                        <Input placeholder="https://..." {...field} className="flex-1" />
                                    </div>
                                </div>
                            </FormControl>
                            <FormDescription>
                                Choose an avatar from the list or enter a custom URL.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit" disabled={isUpdating}>
                    {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Update Profile
                </Button>
            </form>
        </Form>
    );
}
